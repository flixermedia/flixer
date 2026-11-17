import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Unauthorized } from "@tsed/exceptions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { LoggerQueryProxy } from "./loggerQueryProxy.js";

describe("logger query relay", () => {
	let directory: string;
	let store: ConfigStore;
	const requireAdmin = vi.fn(async (header?: string) => {
		if (header !== "Bearer admin") throw new Unauthorized("Admin required.");
	});
	const issueQueryToken = vi.fn(async () => ({
		endpoint: "https://logger.example", token: "query-secret", expiresAt: new Date(Date.now() + 60_000).toISOString(),
	}));
	let proxy: LoggerQueryProxy;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "logger-query-proxy-"));
		store = new ConfigStore(directory);
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: "m".repeat(43) });
		setAppConfig(new AppConfig(store));
		requireAdmin.mockClear();
		issueQueryToken.mockClear();
		proxy = new LoggerQueryProxy({ requireAdmin }, { issueQueryToken });
	});

	afterEach(() => {
		setAppConfig(undefined);
		store.close();
		vi.unstubAllGlobals();
		rmSync(directory, { recursive: true, force: true });
	});

	it("authorizes each request, coalesces query credentials, and forwards only permitted paths", async () => {
		const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response('{"events":[]}'));
		vi.stubGlobal("fetch", fetcher);
		await expect(proxy.query("recent", "?limit=100", undefined, undefined)).rejects.toThrow("Admin required");
		expect(issueQueryToken).not.toHaveBeenCalled();
		const results = await Promise.all([
			proxy.query("recent", "?limit=100", undefined, undefined, "Bearer admin"),
			proxy.query("stats", "?start=a&end=b", undefined, undefined, "Bearer admin"),
		]);
		expect(issueQueryToken).toHaveBeenCalledOnce();
		expect(requireAdmin).toHaveBeenCalledTimes(3);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			"https://logger.example/api/logs?limit=100", "https://logger.example/api/logs/stats?start=a&end=b",
		]);
		for (const result of results) {
			let value = "";
			for await (const chunk of result.stream) value += chunk.toString();
			expect(value).toBe('{"events":[]}');
			expect(result.contentType).toBe("application/json");
		}
		await expect(proxy.query("__proto__", "", undefined, undefined, "Bearer admin")).rejects.toThrow("Invalid logger query");
		await expect(proxy.query("search", "", undefined, undefined, "Bearer admin")).rejects.toThrow("Invalid logger query method");
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("forwards stream cursors and preserves replay errors without exposing response bodies", async () => {
		const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response("sensitive details", { status: 410 }));
		vi.stubGlobal("fetch", fetcher);
		await expect(proxy.query("stream", "?app=flixer", undefined, "cursor", "Bearer admin")).rejects.toMatchObject({
			status: 410, message: "The logger rejected the query.",
		});
		const [url, options] = fetcher.mock.calls[0]!;
		expect(url).toBe("https://logger.example/api/logs/stream?app=flixer");
		expect(new Headers(options?.headers).get("last-event-id")).toBe("cursor");
		expect(new Headers(options?.headers).get("authorization")).toBe("Bearer query-secret");
	});

	it("invalidates a rejected cached credential and obtains a fresh one", async () => {
		const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response("denied", { status: 401 }));
		vi.stubGlobal("fetch", fetcher);
		await expect(proxy.query("recent", "", undefined, undefined, "Bearer admin")).rejects.toMatchObject({ status: 503 });
		await expect(proxy.query("recent", "", undefined, undefined, "Bearer admin")).rejects.toMatchObject({ status: 503 });
		expect(issueQueryToken).toHaveBeenCalledTimes(2);
	});

	it("rejects oversized queries before contacting the logger", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		await expect(proxy.query("recent", `?q=${"a".repeat(4096)}`, undefined, undefined, "Bearer admin")).rejects.toThrow("Invalid logger query");
		await expect(proxy.query("search", "", { text: "a".repeat(32_768) }, undefined, "Bearer admin")).rejects.toThrow("too large");
		await expect(proxy.query("stream", "", undefined, "bad\r\ncursor", "Bearer admin")).rejects.toThrow("Invalid logger cursor");
		expect(issueQueryToken).not.toHaveBeenCalled();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("fails rather than returning an oversized non-streaming response", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
				controller.close();
			},
		});
		vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
		const result = await proxy.query("recent", "", undefined, undefined, "Bearer admin");
		await expect(async () => {
			for await (const _chunk of result.stream) { /* consume */ }
		}).rejects.toThrow("size limit");
	});

	it("does not relay records from a replaced logger connection", async () => {
		let source!: ReadableStreamDefaultController<Uint8Array>;
		const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
		vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
		const result = await proxy.query("stream", "", undefined, undefined, "Bearer admin");
		const received: string[] = [];
		const consume = (async () => {
			for await (const chunk of result.stream) received.push(chunk.toString());
		})();
		source.enqueue(new TextEncoder().encode("first\n"));
		await vi.waitFor(() => expect(received).toEqual(["first\n"]));
		store.setMany({ loggerUrl: "https://other.example" });
		source.enqueue(new TextEncoder().encode("old deployment secret\n"));
		await expect(consume).rejects.toThrow("configuration changed");
		expect(received).toEqual(["first\n"]);
	});

	it("refuses to cache a credential if the connection changes during issuance", async () => {
		let resolve!: (value: { endpoint: string; token: string; expiresAt: string }) => void;
		issueQueryToken.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		const pending = proxy.query("recent", "", undefined, undefined, "Bearer admin");
		await vi.waitFor(() => expect(issueQueryToken).toHaveBeenCalledOnce());
		store.setMany({ loggerUrl: "https://other.example" });
		resolve({ endpoint: "https://logger.example", token: "query-secret", expiresAt: new Date(Date.now() + 60_000).toISOString() });
		await expect(pending).rejects.toThrow("configuration changed");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("does not start an upstream query after the client disconnects during credential issuance", async () => {
		let resolve!: (value: { endpoint: string; token: string; expiresAt: string }) => void;
		issueQueryToken.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		const controller = new AbortController();
		const pending = proxy.query("recent", "", undefined, undefined, "Bearer admin", controller.signal);
		await vi.waitFor(() => expect(issueQueryToken).toHaveBeenCalledOnce());
		controller.abort();
		resolve({ endpoint: "https://logger.example", token: "query-secret", expiresAt: new Date(Date.now() + 60_000).toISOString() });
		await expect(pending).rejects.toThrow("cancelled");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("cancels a request waiting for upstream response headers on disconnect", async () => {
		const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
			options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
		}));
		vi.stubGlobal("fetch", fetcher);
		const controller = new AbortController();
		const pending = proxy.query("recent", "", undefined, undefined, "Bearer admin", controller.signal);
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		controller.abort();
		await expect(pending).rejects.toThrow("could not be completed");
		expect(fetcher.mock.calls[0]?.[1].signal?.aborted).toBe(true);
	});
});
