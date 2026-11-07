import { Inject, Injectable } from "@tsed/di";
import { Exception } from "@tsed/exceptions";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { AI_SIGNATURE_HEADER, AI_TIMESTAMP_HEADER, verifyAiRequest } from "../ai/aiAuth.js";
import { INDEXER_SIGNATURE_HEADER, INDEXER_TIMESTAMP_HEADER, verifyIndexerRequest } from "../indexer/indexerAuth.js";
import { LoggerService, type LoggerProducer } from "./loggerService.js";

const paths: Record<string, { app: LoggerProducer; ai?: true }> = {
	"/api/internal/logger/indexer": { app: "flixer-indexer" },
	"/api/internal/logger/streamer": { app: "flixer-streamer" },
	"/api/internal/logger/updater": { app: "flixer-updater" },
	"/api/internal/ai/logger-configuration": { app: "flixer-ai", ai: true },
};

function header(req: IncomingMessage, name: string): string | undefined {
	const values = req.headersDistinct[name];
	return values?.length === 1 ? values[0] : undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" });
	res.end(JSON.stringify(body));
}

async function clearStaleSocket(path: string): Promise<void> {
	let info;
	try {
		info = lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	if (!info.isSocket() || info.uid !== process.geteuid?.()) throw new Error("Logger control path is not an owned socket.");
	await new Promise<void>((resolve, reject) => {
		const socket = connect(path);
		socket.setTimeout(1_000, () => socket.destroy(new Error("Logger control socket probe timed out.")));
		socket.once("connect", () => {
			socket.destroy();
			reject(new Error("Logger control socket is already in use."));
		});
		socket.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code !== "ECONNREFUSED" && error.code !== "ENOENT") {
				reject(error);
				return;
			}
			try {
				const current = lstatSync(path);
				if (current.dev !== info.dev || current.ino !== info.ino) throw new Error("Logger control socket changed.");
				unlinkSync(path);
				resolve();
			} catch (unlinkError) {
				if ((unlinkError as NodeJS.ErrnoException).code === "ENOENT") resolve();
				else reject(unlinkError);
			}
		});
	});
}

/** Starts a signed, bounded local-only credential channel on a protected socket. */
export async function startLoggerControlSocket(path: string, logger: Pick<LoggerService, "producerIngestConfiguration">): Promise<Server> {
	if (!isAbsolute(path)) throw new Error("Logger control socket path must be absolute.");
	const directory = lstatSync(dirname(path));
	if (!directory.isDirectory() || (directory.mode & 0o022) !== 0 || directory.uid !== process.geteuid?.()) {
		throw new Error("Logger control socket directory must be protected.");
	}
	await clearStaleSocket(path);
	let active = 0;
	let lastEnrollmentFailure = 0;
	let suppressedFailures = 0;
	const server = createServer({ maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, (req, res) => {
		if (active >= 32) {
			json(res, 503, { error: "Logger control is busy." });
			return;
		}
		const route = req.url && Object.hasOwn(paths, req.url) ? paths[req.url] : undefined;
		if (req.method !== "GET" || !route || req.headers["transfer-encoding"] ||
			(req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0")) {
			json(res, 404, { error: "Not found." });
			return;
		}
		try {
			if (route.ai) {
				const signature = header(req, AI_SIGNATURE_HEADER);
				if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) throw new Exception(401, "Invalid signature.");
				verifyAiRequest({ method: "GET", path: req.url!, body: new Uint8Array(),
					timestamp: header(req, AI_TIMESTAMP_HEADER), signature });
			} else {
				const signature = header(req, INDEXER_SIGNATURE_HEADER);
				if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) throw new Exception(401, "Invalid signature.");
				verifyIndexerRequest({ method: "GET", path: req.url!, body: new Uint8Array(),
					timestamp: header(req, INDEXER_TIMESTAMP_HEADER), signature });
			}
		} catch (error) {
			if (!(error instanceof Exception) || error.status !== 401) {
				process.stderr.write("Flixer logger: producer authentication failed unexpectedly\n");
			}
			json(res, 401, { error: "Unauthorized." });
			return;
		}
		active++;
		void logger.producerIngestConfiguration(route.app).then((configuration) => {
			json(res, 200, configuration);
		}, () => {
			const now = Date.now();
			if (now - lastEnrollmentFailure >= 60_000) {
				process.stderr.write(`Flixer logger: producer enrollment failed (suppressed diagnostics: ${suppressedFailures})\n`);
				lastEnrollmentFailure = now;
				suppressedFailures = 0;
			} else {
				suppressedFailures++;
			}
			json(res, 503, { error: "Logger enrollment unavailable." });
		}).finally(() => { active--; });
	});
	server.headersTimeout = 5_000;
	server.requestTimeout = 5_000;
	server.maxConnections = 64;
	server.maxRequestsPerSocket = 1;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => {
			server.off("error", reject);
			try {
				chmodSync(path, 0o666);
				resolve();
			} catch (error) {
				server.close();
				reject(error);
			}
		});
	});
	server.on("error", () => process.stderr.write("Flixer logger: control socket encountered an error\n"));
	return server;
}

@Injectable()
export class LoggerControlSocket {
	private server?: Server;

	constructor(@Inject(LoggerService) private readonly logger: LoggerService) {}

	async $onReady(): Promise<void> {
		const path = process.env.FLIXER_LOGGER_CONTROL_SOCKET?.trim();
		if (!path) return;
		try {
			this.server = await startLoggerControlSocket(path, this.logger);
		} catch (error) {
			process.stderr.write(`Flixer logger: control socket could not start: ${error instanceof Error ? error.message : "unknown error"}\n`);
		}
	}

	async $onDestroy(): Promise<void> {
		if (!this.server) return;
		await new Promise<void>((resolve, reject) => this.server!.close((error) => error ? reject(error) : resolve()));
	}
}
