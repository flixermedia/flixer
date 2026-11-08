import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";

const mocks = vi.hoisted(() => ({ sign: vi.fn(), warn: vi.fn() }));
vi.mock("@tsed/di", async (importOriginal) => ({
	...await importOriginal<typeof import("@tsed/di")>(),
	logger: () => ({ warn: mocks.warn }),
}));
vi.mock("./indexerAuth.js", () => ({ signIndexerRequest: mocks.sign }));

import { IndexerClient } from "./indexerClient.js";

describe("IndexerClient artwork requests", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		mocks.sign.mockReset();
		mocks.warn.mockReset();
	});

	it("returns artwork from the indexer", async () => {
		mocks.sign.mockReturnValue({ "x-indexer-signature": "signature" });
		const fetch = vi.fn().mockResolvedValue(new Response(Buffer.from("image"), {
			headers: { "content-type": "image/jpeg" },
		}));
		vi.stubGlobal("fetch", fetch);
		const client = new IndexerClient();
		vi.spyOn(client, "baseUrl").mockReturnValue("http://indexer:8092");

		await expect(client.fetchImage("/media/poster.jpg")).resolves.toEqual({
			data: Buffer.from("image"), contentType: "image/jpeg",
		});
		expect(fetch).toHaveBeenCalledOnce();
		expect(mocks.sign).toHaveBeenCalledWith("POST", "/internal/image", expect.any(Buffer));
	});

	it("logs a safe connection error code without exposing the image path or error text", async () => {
		mocks.sign.mockReturnValue({});
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("private path", {
			cause: Object.assign(new Error("private address"), { code: "ECONNRESET" }),
		})));
		const client = new IndexerClient();
		vi.spyOn(client, "baseUrl").mockReturnValue("http://indexer:8092");

		await expect(client.fetchImage("/private/poster.jpg")).rejects.toMatchObject({
			status: 503, message: "flixer-indexer is not reachable.",
		});
		expect(mocks.warn).toHaveBeenCalledWith("Indexer artwork request failed: ECONNRESET.");
	});

	it("reports an actual refused connection without leaking request details", async () => {
		mocks.sign.mockReturnValue({});
		const server = createServer();
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test listener address.");
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		const client = new IndexerClient();
		vi.spyOn(client, "baseUrl").mockReturnValue(`http://127.0.0.1:${address.port}`);

		await expect(client.fetchImage("/private/poster.jpg")).rejects.toMatchObject({ status: 503 });
		expect(mocks.warn).toHaveBeenCalledWith("Indexer artwork request failed: ECONNREFUSED.");
	});

	it("does not include unrecognized transport details in logs", async () => {
		mocks.sign.mockReturnValue({});
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private path", {
			cause: { code: "private-token" },
		})));
		const client = new IndexerClient();
		vi.spyOn(client, "baseUrl").mockReturnValue("http://indexer:8092");

		await expect(client.fetchImage("/private/poster.jpg")).rejects.toMatchObject({ status: 503 });
		expect(mocks.warn).toHaveBeenCalledWith("Indexer artwork request failed: unknown.");
	});

	it.each([[404, 404], [500, 502]])("preserves indexer HTTP %i as %i", async (upstream, expected) => {
		mocks.sign.mockReturnValue({});
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: upstream })));
		const client = new IndexerClient();
		vi.spyOn(client, "baseUrl").mockReturnValue("http://indexer:8092");

		await expect(client.fetchImage("/media/poster.jpg")).rejects.toMatchObject({ status: expected });
		expect(mocks.warn).not.toHaveBeenCalled();
	});

	it("does not mistake signing errors for an unreachable indexer", async () => {
		const error = new Error("signing failed");
		mocks.sign.mockImplementation(() => { throw error; });
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const client = new IndexerClient();
		vi.spyOn(client, "baseUrl").mockReturnValue("http://indexer:8092");

		await expect(client.fetchImage("/media/poster.jpg")).rejects.toBe(error);
		expect(fetch).not.toHaveBeenCalled();
		expect(mocks.warn).not.toHaveBeenCalled();
	});

	it("distinguishes timeouts without exposing unexpected error details", async () => {
		mocks.sign.mockReturnValue({});
		const controller = new AbortController();
		controller.abort();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private timeout")));
		const client = new IndexerClient();
		vi.spyOn(client, "baseUrl").mockReturnValue("http://indexer:8092");

		await expect(client.fetchImage("/media/poster.jpg")).rejects.toMatchObject({ status: 503 });
		expect(mocks.warn).toHaveBeenCalledWith("Indexer artwork request failed: timeout.");
	});
});
