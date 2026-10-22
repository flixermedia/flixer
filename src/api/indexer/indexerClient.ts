import { Injectable } from "@tsed/di";
import { Exception } from "@tsed/exceptions";
import { signIndexerRequest } from "./indexerAuth.js";

const DEFAULT_INDEXER_URL = "http://localhost:8092";
const REQUEST_TIMEOUT_MS = 15_000;

export interface IndexerRequestOptions {
	query?: Record<string, string | number | undefined>;
	body?: unknown;
	timeoutMs?: number;
}

/** Signed HTTP client for flixer-indexer's internal API. */
@Injectable()
export class IndexerClient {

	baseUrl(): string {
		return (process.env.INDEXER_URL?.trim() || process.env.INDEXER_INTERNAL_URL?.trim() || DEFAULT_INDEXER_URL).replace(/\/+$/, "");
	}

	async request<T = unknown>(method: "GET" | "POST", path: string, options: IndexerRequestOptions = {}): Promise<T> {
		const body = options.body === undefined ? new Uint8Array() : Buffer.from(JSON.stringify(options.body));
		const url = new URL(this.baseUrl() + path);
		for (const [name, value] of Object.entries(options.query ?? {})) {
			if (value !== undefined && value !== "") {
				url.searchParams.set(name, String(value));
			}
		}

		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers: {
					...signIndexerRequest(method, url.pathname, body),
					...(body.length > 0 ? { "content-type": "application/json" } : {}),
				},
				body: body.length > 0 ? body : undefined,
				signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new Exception(503, "flixer-indexer is not reachable.");
		}

		const text = await response.text();
		let payload: unknown = null;
		try {
			payload = text ? JSON.parse(text) : null;
		} catch {
			payload = null;
		}
		if (!response.ok) {
			const message = (payload as { error?: string } | null)?.error;
			throw new Exception(response.status >= 500 ? 502 : response.status, message ?? `flixer-indexer returned status ${response.status}.`);
		}
		return payload as T;
	}

	/** Fetches an artwork file from the indexer's disk. The path travels in the signed body. */
	async fetchImage(path: string): Promise<{ data: Buffer; contentType: string }> {
		const body = Buffer.from(JSON.stringify({ path }));
		const url = new URL(`${this.baseUrl()}/internal/image`);
		let response: Response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: { ...signIndexerRequest("POST", url.pathname, body), "content-type": "application/json" },
				body,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new Exception(503, "flixer-indexer is not reachable.");
		}
		if (!response.ok) {
			throw new Exception(response.status === 404 ? 404 : response.status >= 500 ? 502 : response.status, "The image could not be loaded.");
		}
		return { data: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
	}

	/** Asks the indexer to re-read settings and libraries; failures are not fatal because the indexer also polls. */
	async reloadSettings(): Promise<void> {
		await this.request("POST", "/internal/settings/reload").catch(() => undefined);
	}
}
