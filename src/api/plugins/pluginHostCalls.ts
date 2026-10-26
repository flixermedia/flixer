import { lookup as dnsLookup } from "node:dns/promises";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { isPublicRepositoryAddress } from "./pluginRepositoryClient.js";

export const MAX_HOST_CALLS_PER_ROUND = 8;
export const MAX_HOST_CALL_ROUNDS = 4;
const MAX_RESPONSE_BYTES = 256 * 1024;
const HTTP_TIMEOUT_MS = 4_000;

export interface HostCall {
	id: string;
	op: "http.get";
	url: string;
}

export interface HostResult {
	id: string;
	ok: boolean;
	status?: number;
	body?: string;
	error?: string;
}

export type HttpGet = (url: URL) => Promise<{ status: number; body: string }>;

/** Permission a plugin must declare and be granted to reach this exact hostname. */
export function httpHostPermission(hostname: string): string {
	return `network.http.${hostname.toLowerCase()}`;
}

/** Performs a bounded HTTPS GET against a publicly routable address; redirects are never followed. */
export const publicHttpsGet: HttpGet = async (url) => {
	const addresses = await dnsLookup(url.hostname, { all: true, verbatim: true });
	const selected = addresses[0];
	if (!selected || addresses.some((resolved) => !isPublicRepositoryAddress(resolved.address))) {
		throw new Error("non-public address");
	}
	const agent = new HttpsAgent({
		keepAlive: false,
		lookup: (_hostname, options, callback) => {
			if (options.all) callback(null, [selected]);
			else callback(null, selected.address, selected.family);
		},
	});

	try {
		return await new Promise<{ status: number; body: string }>((resolve, reject) => {
			const request = httpsRequest(
				url,
				{ agent, method: "GET", headers: { accept: "application/json, text/plain" }, timeout: HTTP_TIMEOUT_MS },
				(response) => {
					response.on("error", reject);
					const chunks: Buffer[] = [];
					let size = 0;
					response.on("data", (chunk: Buffer | string) => {
						const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
						size += data.length;
						if (size > MAX_RESPONSE_BYTES) {
							response.destroy(new Error("response too large"));
							return;
						}
						chunks.push(data);
					});
					response.on("end", () =>
						resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
					);
				},
			);
			request.on("timeout", () => request.destroy(new Error("timeout")));
			request.on("error", reject);
			request.end();
		});
	} finally {
		agent.destroy();
	}
};

function parseCalls(value: unknown): HostCall[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HOST_CALLS_PER_ROUND) {
		throw new Error("Plugin requested an invalid number of host calls.");
	}
	const ids = new Set<string>();
	return value.map((raw: unknown) => {
		const call = raw as Partial<HostCall> | null;
		if (
			typeof call !== "object" ||
			call === null ||
			typeof call.id !== "string" ||
			!/^[A-Za-z0-9_-]{1,64}$/.test(call.id) ||
			ids.has(call.id) ||
			call.op !== "http.get" ||
			typeof call.url !== "string"
		) {
			throw new Error("Plugin requested an invalid host call.");
		}
		ids.add(call.id);
		return { id: call.id, op: call.op, url: call.url };
	});
}

/** Runs a plugin's host calls under its approved permissions; denied or failed calls yield per-call errors. */
export async function executeHostCalls(
	rawCalls: unknown,
	approvedPermissions: ReadonlySet<string>,
	httpGet: HttpGet = publicHttpsGet,
): Promise<HostResult[]> {
	const calls = parseCalls(rawCalls);
	return Promise.all(
		calls.map(async (call): Promise<HostResult> => {
			let url: URL;
			try {
				url = new URL(call.url);
			} catch {
				return { id: call.id, ok: false, error: "invalid_url" };
			}
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				(url.port && url.port !== "443") ||
				call.url.length > 2048
			) {
				return { id: call.id, ok: false, error: "invalid_url" };
			}
			if (!approvedPermissions.has(httpHostPermission(url.hostname))) {
				return { id: call.id, ok: false, error: "permission_denied" };
			}
			try {
				const { status, body } = await httpGet(url);
				return { id: call.id, ok: status >= 200 && status < 300, status, body };
			} catch {
				return { id: call.id, ok: false, error: "request_failed" };
			}
		}),
	);
}
