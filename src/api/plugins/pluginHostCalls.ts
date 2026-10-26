import { lookup as dnsLookup } from "node:dns/promises";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { isPublicRepositoryAddress } from "./pluginRepositoryClient.js";

export const MAX_HOST_CALLS_PER_ROUND = 8;
export const MAX_HOST_CALL_ROUNDS = 4;
const MAX_RESPONSE_BYTES = 256 * 1024;
const HTTP_TIMEOUT_MS = 4_000;

export interface HostCall {
	id: string;
	op: string;
	[key: string]: unknown;
}

export interface HostResult {
	id: string;
	ok: boolean;
	status?: number;
	body?: string;
	error?: string;
	[key: string]: unknown;
}

export interface HttpOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

export type HttpRequest = (url: URL, options?: HttpOptions) => Promise<{ status: number; body: string }>;
export type ServiceHandler = (call: HostCall) => Promise<HostResult>;

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);
const ALLOWED_HEADERS = new Set(["authorization", "x-api-key", "x-emby-token", "content-type", "accept"]);
const MAX_HEADERS = 8;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

/** Permission that lets a plugin reach any public HTTPS host (user-configured servers). */
export const HTTP_ANY_PERMISSION = "network.http.any";
export type HttpGet = HttpRequest;

const MAX_POST_BODY_BYTES = 16 * 1024;

/** Permission a plugin must declare and be granted to reach this exact hostname. */
export function httpHostPermission(hostname: string): string {
	return `network.http.${hostname.toLowerCase()}`;
}

/** Performs a bounded HTTPS GET against a publicly routable address; redirects are never followed. */
export const publicHttpsGet: HttpRequest = async (url, options) => {
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
				{
					agent,
					method: options?.method ?? (options?.body === undefined ? "GET" : "POST"),
					headers: {
						accept: "application/json, text/plain",
						"user-agent": "Flixer",
						...(options?.body === undefined
							? {}
							: {
									"content-type": "application/json",
									"content-length": Buffer.byteLength(options.body),
								}),
						...options?.headers,
					},
					timeout: HTTP_TIMEOUT_MS,
				},
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
			request.end(options?.body);
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
		const call = raw as HostCall | null;
		if (
			typeof call !== "object" ||
			call === null ||
			Array.isArray(call) ||
			typeof call.id !== "string" ||
			!/^[A-Za-z0-9_-]{1,64}$/.test(call.id) ||
			ids.has(call.id) ||
			typeof call.op !== "string" ||
			(call.op === "http.get" && call.body !== undefined) ||
			(call.op === "http.post" &&
				(typeof call.body !== "string" || Buffer.byteLength(call.body) > MAX_POST_BODY_BYTES))
		) {
			throw new Error("Plugin requested an invalid host call.");
		}
		ids.add(call.id);
		return call;
	});
}

function parseHttpCall(call: HostCall): { url: URL; options?: HttpOptions } | null {
	if (typeof call.url !== "string" || call.url.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(call.url);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
	if (call.op === "http.get") return call.body === undefined ? { url } : null;
	if (call.op === "http.post") {
		return typeof call.body === "string" && Buffer.byteLength(call.body) <= MAX_POST_BODY_BYTES
			? { url, options: { body: call.body } }
			: null;
	}
	const method = typeof call.method === "string" ? call.method.toUpperCase() : "GET";
	if (!HTTP_METHODS.has(method)) return null;
	if (call.body !== undefined && (typeof call.body !== "string" || Buffer.byteLength(call.body) > MAX_REQUEST_BODY_BYTES)) {
		return null;
	}
	const headers: Record<string, string> = {};
	if (call.headers !== undefined) {
		if (typeof call.headers !== "object" || call.headers === null || Array.isArray(call.headers)) return null;
		const entries = Object.entries(call.headers as Record<string, unknown>);
		if (entries.length > MAX_HEADERS) return null;
		for (const [name, value] of entries) {
			const key = name.toLowerCase();
			if (!ALLOWED_HEADERS.has(key) || typeof value !== "string" || value.length > 2048 || /[\r\n]/.test(value)) {
				return null;
			}
			headers[key] = value;
		}
	}
	return { url, options: { method, headers, ...(call.body === undefined ? {} : { body: call.body as string }) } };
}

/** Runs a plugin's host calls under its approved permissions; denied or failed calls yield per-call errors. */
export async function executeHostCalls(
	rawCalls: unknown,
	approvedPermissions: ReadonlySet<string>,
	httpGet: HttpRequest = publicHttpsGet,
	service?: ServiceHandler,
): Promise<HostResult[]> {
	const calls = parseCalls(rawCalls);
	const results = new Map<string, HostResult>();

	const runHttp = async (call: HostCall): Promise<HostResult> => {
		const parsed = parseHttpCall(call);
		if (!parsed) return { id: call.id, ok: false, error: "invalid_url" };
		if (!approvedPermissions.has(HTTP_ANY_PERMISSION) && !approvedPermissions.has(httpHostPermission(parsed.url.hostname))) {
			return { id: call.id, ok: false, error: "permission_denied" };
		}
		try {
			const { status, body } = await httpGet(parsed.url, parsed.options);
			return { id: call.id, ok: status >= 200 && status < 300, status, body };
		} catch {
			return { id: call.id, ok: false, error: "request_failed" };
		}
	};

	const isHttp = (call: HostCall) => call.op === "http.get" || call.op === "http.post" || call.op === "http.request";
	await Promise.all(
		calls.filter(isHttp).map(async (call) => {
			results.set(call.id, await runHttp(call));
		}),
	);
	for (const call of calls.filter((entry) => !isHttp(entry))) {
		results.set(call.id, service ? await service(call) : { id: call.id, ok: false, error: "invalid_request" });
	}
	return calls.map((call) => results.get(call.id)!);
}
