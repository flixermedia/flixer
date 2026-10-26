import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Unauthorized } from "@tsed/exceptions";
import { version } from "../config/config.js";
import { INDEXER_SIGNATURE_HEADER, INDEXER_TIMESTAMP_HEADER, verifyIndexerRequest } from "../api/indexer/indexerAuth.js";
import { indexerRuntimeConfig, internalConfigPath } from "./internalConfig.js";
import { handleSetupRequest } from "../setup/setupApi.js";
import { RECOVERY_CODE_HEADER } from "../setup/recovery.js";
import { setupStatus } from "./setupStatus.js";
import { CORS_METHODS, CORS_ORIGINS } from "../cors.js";

const MAX_BODY_BYTES = 64 * 1024;

class BodyTooLarge extends Error {}

function readJson(request: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let tooLarge = false;
		request.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				// Keep draining without storing so the 413 can still be delivered before the connection closes.
				if (!tooLarge) {
					tooLarge = true;
					chunks.length = 0;
					reject(new BodyTooLarge());
				}
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (tooLarge) {
				return;
			}
			try {
				resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
			} catch {
				reject(new SyntaxError("Invalid JSON."));
			}
		});
		request.on("error", reject);
	});
}

async function handleSetup(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
	if (request.method !== "GET" && request.method !== "POST") {
		return false;
	}
	let body: unknown = {};
	if (request.method === "POST") {
		try {
			body = await readJson(request);
		} catch (error: unknown) {
			response.setHeader("connection", "close");
			send(response, error instanceof BodyTooLarge ? 413 : 400, { error: error instanceof BodyTooLarge ? "Request body is too large." : "Request body must be valid JSON." });
			return true;
		}
	}
	// No database means no accounts, so nobody can be an administrator here and setup is only open while it is unprotected.
	const result = await handleSetupRequest(request.method, path, body, { isAdmin: async () => false, adminExists: async () => false, recoveryCode: typeof request.headers[RECOVERY_CODE_HEADER] === "string" ? (request.headers[RECOVERY_CODE_HEADER] as string) : undefined });
	if (!result) {
		return false;
	}
	send(response, result.status, result.body);
	return true;
}

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" } as const;

function send(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, HEADERS);
	response.end(JSON.stringify(body));
}

/** Routes served before the full application is running. Everything else answers 503 so clients show "unavailable". */
export async function handleBootstrapRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const origin = request.headers.origin;
	const allowedOrigin = typeof origin === "string" && CORS_ORIGINS.some((allowed) => allowed === origin);
	if (allowedOrigin) {
		response.setHeader("access-control-allow-origin", origin);
		response.setHeader("vary", "Origin");
	}
	if (request.method === "OPTIONS" && allowedOrigin) {
		response.setHeader("access-control-allow-methods", CORS_METHODS.join(", "));
		const requestedHeaders = request.headers["access-control-request-headers"];
		if (typeof requestedHeaders === "string") {
			response.setHeader("access-control-allow-headers", requestedHeaders);
		}
		response.writeHead(204);
		response.end();
		return;
	}
	const path = (request.url ?? "/").split("?")[0].replace(/\/+$/, "") || "/";
	if (request.method === "GET" && path === "/api/setup/status") {
		send(response, 200, setupStatus());
		return;
	}
	if (request.method === "GET" && path === "/api/version") {
		send(response, 200, { version });
		return;
	}
	if (request.method === "GET" && path === internalConfigPath("indexer")) {
		// The indexer needs its Redis settings even while setup is unfinished.
		try {
			const header = (name: string) => (typeof request.headers[name] === "string" ? (request.headers[name] as string) : undefined);
			verifyIndexerRequest({ method: "GET", path, body: new Uint8Array(), timestamp: header(INDEXER_TIMESTAMP_HEADER), signature: header(INDEXER_SIGNATURE_HEADER) });
			send(response, 200, indexerRuntimeConfig());
		} catch (error: unknown) {
			send(response, error instanceof Unauthorized ? 401 : 500, { error: error instanceof Unauthorized ? "unauthorized" : "internal_error" });
		}
		return;
	}
	if (path.startsWith("/api/setup/")) {
		try {
			if (await handleSetup(request, response, path)) {
				return;
			}
		} catch {
			send(response, 500, { error: "internal_error" });
			return;
		}
	}
	response.setHeader("retry-after", "5");
	send(response, 503, { error: "service_unavailable", message: "Flixer is starting. Try again in a moment." });
}

export function startBootstrapServer(port: number): Promise<Server> {
	return new Promise((resolve, reject) => {
		const server = createServer((request, response) => void handleBootstrapRequest(request, response));
		server.once("error", reject);
		server.listen(port, () => {
			server.off("error", reject);
			resolve(server);
		});
	});
}

export function stopBootstrapServer(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.close(() => resolve());
		server.closeAllConnections();
	});
}
