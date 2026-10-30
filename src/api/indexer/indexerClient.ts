import { Injectable } from "@tsed/di";
import { Exception } from "@tsed/exceptions";
import { appConfig } from "../../config/store/appConfig.js";
import { signIndexerRequest } from "./indexerAuth.js";

const DEFAULT_INDEXER_URL = "http://localhost:8092";
const REQUEST_TIMEOUT_MS = 15_000;

export interface IndexerRequestOptions {
	query?: Record<string, string | number | undefined>;
	body?: unknown;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface IndexerThemeTask {
	libraryId: string;
	path: string;
	rootId: string;
	relativePath: string;
	itemType: "movie" | "series";
	tmdbId: string;
}

export interface IndexerPluginStatus {
	id: string;
	state: "registered" | "error" | string;
	error?: string;
}

/** Signed HTTP client for flixer-indexer's internal API. */
@Injectable()
export class IndexerClient {
	baseUrl(): string {
		return (appConfig().get("indexerUrl") || DEFAULT_INDEXER_URL).replace(/\/+$/, "");
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
				signal: options.signal
					? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)])
					: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			if (options.signal?.aborted) throw error;
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
			throw new Exception(
				response.status >= 500 ? 502 : response.status,
				message ?? `flixer-indexer returned status ${response.status}.`,
			);
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
			throw new Exception(
				response.status === 404 ? 404 : response.status >= 500 ? 502 : response.status,
				"The image could not be loaded.",
			);
		}
		return {
			data: Buffer.from(await response.arrayBuffer()),
			contentType: response.headers.get("content-type") ?? "application/octet-stream",
		};
	}

	/** An item's downloaded theme song, or null when the indexer has none. */
	async fetchTheme(task: IndexerThemeTask): Promise<Buffer | null> {
		const body = Buffer.from(JSON.stringify(task));
		const url = new URL(`${this.baseUrl()}/internal/theme`);
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
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			throw new Exception(response.status >= 500 ? 502 : response.status, "The theme could not be loaded.");
		}
		return Buffer.from(await response.arrayBuffer());
	}

	/** Fetches a person photo through the indexer, which downloads it once and serves it from its cache. */
	async fetchPersonImage(id: string, photoUrl: string): Promise<{ data: Buffer; mime: string }> {
		const body = Buffer.from(JSON.stringify({ id, url: photoUrl }));
		const url = new URL(`${this.baseUrl()}/internal/people/image`);
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
			throw new Exception(response.status === 404 ? 404 : 502, "The image could not be loaded.");
		}
		return {
			data: Buffer.from(await response.arrayBuffer()),
			mime: response.headers.get("content-type")?.split(";")[0].trim() ?? "image/jpeg",
		};
	}

	/** Looks up a person's biography through the indexer; resolves to null when none exists. */
	async fetchPersonBio(
		name: string,
		kind: string,
	): Promise<{ description: string; biography: string; url: string; source: string; imageUrl?: string } | null> {
		try {
			return await this.request("POST", "/internal/people/bio", { body: { name, kind }, timeoutMs: 8_000 });
		} catch (error) {
			if ((error as { status?: number }).status === 404) {
				return null;
			}
			throw error;
		}
	}

	/** Asks the indexer to re-read settings and libraries; failures are not fatal because the indexer also polls. */
	async reloadSettings(): Promise<void> {
		await this.request("POST", "/internal/settings/reload").catch(() => undefined);
	}

	async pluginStatuses(): Promise<IndexerPluginStatus[]> {
		const response = await this.request<{ plugins?: IndexerPluginStatus[] }>("GET", "/internal/plugins", {
			timeoutMs: 5_000,
		});
		return Array.isArray(response.plugins) ? response.plugins : [];
	}
}
