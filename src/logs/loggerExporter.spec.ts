import { afterEach, describe, expect, it, vi } from "vitest";
import { LoggerExporter } from "./loggerExporter.js";
import type { UnifiedLogRecord } from "./unifiedLog.js";

const config = { endpoint: "https://logger.example", token: "ingest-token", expiresAt: "2099-01-01T00:00:00.000Z" };
const record: UnifiedLogRecord = {
	time: "2026-01-01T00:00:00.000Z",
	level: "info",
	app: "flixer",
	source: "server",
	message: 'starting password=hunter2 {"access_token":"jsonsecret"} https://example.com/secret user@example.com /home/user/movie',
	access_token: "do-not-export",
	taskId: "task-123",
	requestId: "invalid request id",
};

describe("logger exporter", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("flushes queued batches on shutdown without accepting new events", async () => {
		const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
			const body = JSON.parse(String(options.body)) as { events: unknown[] };
			return new Response(JSON.stringify({ accepted: body.events.length }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		for (let index = 0; index < 205; index++) exporter.enqueue(record);
		const shutdown = exporter.shutdown(2000);
		exporter.enqueue(record);
		await shutdown;
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(fetcher.mock.calls.map(([, options]) => (JSON.parse(String(options.body)) as { events: unknown[] }).events.length)).toEqual([100, 100, 5]);
		expect(exporter.status()).toMatchObject({ enabled: false, queued: 0, dropped: 0 });
	});

	it("aborts stalled delivery and discards buffered events within the shutdown deadline", async () => {
		vi.useFakeTimers();
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
			options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
		}));
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		for (let index = 0; index < 101; index++) exporter.enqueue(record);
		const shutdown = exporter.shutdown(100);
		expect(() => exporter.renewCredential(config)).toThrow("shut down");
		expect(() => exporter.configure(config)).toThrow("shutting down");
		await vi.advanceTimersByTimeAsync(100);
		await shutdown;
		await vi.runAllTimersAsync();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(exporter.status()).toMatchObject({ enabled: false, queued: 0, sending: false, dropped: 101 });
	});

	it("waits for an in-flight batch before flushing remaining events", async () => {
		vi.useFakeTimers();
		let resolveFirst: ((response: Response) => void) | undefined;
		const fetcher = vi.fn((_url: string, _options: RequestInit) =>
			fetcher.mock.calls.length === 1
				? new Promise<Response>((resolve) => { resolveFirst = resolve; })
				: Promise.resolve(new Response(JSON.stringify({ accepted: 1 }), { status: 200 })));
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(1000);
		exporter.enqueue(record);
		const shutdown = exporter.shutdown(2000);
		if (!resolveFirst) throw new Error("Missing in-flight request");
		resolveFirst(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
		await vi.advanceTimersByTimeAsync(0);
		await shutdown;
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(exporter.status()).toMatchObject({ enabled: false, queued: 0, dropped: 0 });
	});

	it("does nothing when disabled and asynchronously delivers sanitized events when configured", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetcher).not.toHaveBeenCalled();
		exporter.configure(config);
		exporter.enqueue(record);
		expect(fetcher).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(exporter.status()).toMatchObject({ enabled: true, queued: 0, dropped: 0 });
		expect(exporter.status().lastDeliveredAt).not.toBeNull();
		const [url, options] = fetcher.mock.calls[0];
		expect(url).toBe("https://logger.example/api/logs/batch");
		expect(new Headers(options.headers).get("x-flixer-log-schema")).toBe("1");
		expect(new Headers(options.headers).get("authorization")).toBe("Bearer ingest-token");
		const body = String(options.body);
		expect(body).not.toContain("hunter2");
		expect(body).not.toContain("jsonsecret");
		expect(body).not.toContain("example.com/secret");
		expect(body).not.toContain("user@example.com");
		expect(body).not.toContain("/home/user/movie");
		expect(body).not.toContain("do-not-export");
		expect(JSON.parse(body).events[0]).toMatchObject({ app: "flixer", source: "server", level: "info" });
		expect(JSON.parse(body).events[0]).toMatchObject({ task_id: "task-123" });
		expect(JSON.parse(body).events[0]).not.toHaveProperty("request_id");
		exporter.configure();
	});

	it("exports a bounded duration and trace identifier", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
			new Response(JSON.stringify({ accepted: 2 }), { status: 200 }));
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue({ ...record, trace_id: "a".repeat(32), duration_ms: 12.5, status_code: 503 });
		exporter.enqueue({ ...record, status_code: 999, private_data: "must-not-export" });
		await vi.advanceTimersByTimeAsync(1000);
		const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
		expect(body.events[0]).toMatchObject({ trace_id: "a".repeat(32), duration_ms: 12.5, fields: { status_code: 503 } });
		expect(body.events[1]).not.toHaveProperty("fields");
		expect(JSON.stringify(body)).not.toContain("must-not-export");
		exporter.configure();
	});

	it("isolates rejected events and delivers valid siblings", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
			const events = (JSON.parse(String(options.body)) as { events: { message: string }[] }).events;
			return events.some((event) => event.message === "invalid")
				? new Response("invalid", { status: 400 })
				: new Response(JSON.stringify({ accepted: events.length }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetcher);
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue({ ...record, message: "valid" });
		exporter.enqueue({ ...record, message: "invalid" });
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("dropped=1"));
		expect(exporter.status()).toMatchObject({ dropped: 1 });
		expect(exporter.status().lastFailureAt).not.toBeNull();
		exporter.configure();
	});

	it("keeps queued records when the control plane renews the ingestion credential", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
			new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		const replacement = { ...config, token: "replacement-ingest-token" };
		exporter.configure(config);
		exporter.enqueue(record);
		exporter.renewCredential(replacement);
		expect(exporter.status()).toMatchObject({ queued: 1, dropped: 0 });
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(new Headers(fetcher.mock.calls[0][1].headers).get("authorization")).toBe(`Bearer ${replacement.token}`);
		expect(exporter.status()).toMatchObject({ queued: 0, dropped: 0 });
		exporter.configure();
	});

	it("allows an in-flight batch to finish on the old token and sends later batches with the new one", async () => {
		vi.useFakeTimers();
		let resolveFirst: ((response: Response) => void) | undefined;
		let calls = 0;
		const fetcher = vi.fn((_url: string, _options: RequestInit) =>
			++calls === 1
				? new Promise<Response>((resolve) => { resolveFirst = resolve; })
				: Promise.resolve(new Response(JSON.stringify({ accepted: 1 }), { status: 200 })));
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		const replacement = { ...config, token: "replacement-ingest-token" };
		exporter.configure(config);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(1000);
		expect(exporter.status().sending).toBe(true);
		exporter.renewCredential(replacement);
		exporter.enqueue(record);
		if (!resolveFirst) throw new Error("Missing in-flight request");
		resolveFirst(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
		await vi.advanceTimersByTimeAsync(1);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(new Headers(fetcher.mock.calls[0][1].headers).get("authorization")).toBe(`Bearer ${config.token}`);
		expect(new Headers(fetcher.mock.calls[1][1].headers).get("authorization")).toBe(`Bearer ${replacement.token}`);
		expect(exporter.status().dropped).toBe(0);
		exporter.configure();
	});

	it("retries an in-flight unauthorized batch with a renewed credential", async () => {
		vi.useFakeTimers();
		let resolveFirst: ((response: Response) => void) | undefined;
		const fetcher = vi.fn((_url: string, _options: RequestInit) =>
			fetcher.mock.calls.length === 1
				? new Promise<Response>((resolve) => { resolveFirst = resolve; })
				: Promise.resolve(new Response(JSON.stringify({ accepted: 1 }), { status: 200 })));
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		const replacement = { ...config, token: "replacement-ingest-token" };
		exporter.configure(config);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(1000);
		exporter.renewCredential(replacement);
		if (!resolveFirst) throw new Error("Missing in-flight request");
		resolveFirst(new Response("unauthorized", { status: 401 }));
		await vi.advanceTimersByTimeAsync(1);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(new Headers(fetcher.mock.calls[0][1].headers).get("authorization")).toBe(`Bearer ${config.token}`);
		expect(new Headers(fetcher.mock.calls[1][1].headers).get("authorization")).toBe(`Bearer ${replacement.token}`);
		expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
		expect(exporter.status()).toMatchObject({ queued: 0, sending: false, dropped: 0 });
		exporter.configure();
	});

	it("does not retry unauthorized batches without a credential change", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async () => new Response("unauthorized", { status: 401 }));
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(exporter.status()).toMatchObject({ queued: 0, sending: false, dropped: 1 });
		exporter.configure();
	});

	it("discards queued records on manual reconfiguration even for the same origin", () => {
		vi.useFakeTimers();
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue(record);
		exporter.configure({ ...config, token: "another-deployment-token" });
		expect(exporter.status()).toMatchObject({ queued: 0, dropped: 1 });
		exporter.configure();
	});

	it("discards queued records when the target deployment changes", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue(record);
		exporter.configure({ ...config, endpoint: "https://other.example" });
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetcher).not.toHaveBeenCalled();
		exporter.configure();
	});

	it("does not retry or split a schema conflict", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async () => new Response("unsupported schema", { status: 409 }));
		vi.stubGlobal("fetch", fetcher);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue(record);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(exporter.status().dropped).toBe(2);
		exporter.configure();
	});

	it("retries transient errors without changing the event ID", async () => {
		vi.useFakeTimers();
		const bodies: string[] = [];
		const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
			bodies.push(String(options.body));
			return bodies.length === 1
				? new Response("unavailable", { status: 503 })
				: new Response(JSON.stringify({ accepted: 1 }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(bodies[0]).toBe(bodies[1]);
		exporter.configure();
	});

	it("stops accepting events once its credential expires", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn();
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.stubGlobal("fetch", fetcher);
		const exporter = new LoggerExporter();
		exporter.configure({ ...config, expiresAt: "2000-01-01T00:00:00.000Z" });
		exporter.enqueue(record);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetcher).not.toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledOnce();
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("credential expired"));
		exporter.configure();
	});

	it("respects retry-after and interrupts retry delays when reconfigured", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async () => new Response("limited", { status: 429, headers: { "Retry-After": "30" } }));
		vi.stubGlobal("fetch", fetcher);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetcher).toHaveBeenCalledOnce();
		exporter.configure({ ...config, endpoint: "https://other.example" });
		await vi.advanceTimersByTimeAsync(0);
		expect(exporter.status().sending).toBe(false);
		exporter.configure();
	});

	it("opens a bounded circuit after repeated transient delivery failures", async () => {
		vi.useFakeTimers();
		let healthy = false;
		const fetcher = vi.fn(async () => healthy
			? new Response(JSON.stringify({ accepted: 1 }), { status: 200 })
			: new Response("unavailable", { status: 503 }));
		vi.stubGlobal("fetch", fetcher);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exporter = new LoggerExporter();
		exporter.configure(config);
		for (let i = 0; i < 3; i++) {
			exporter.enqueue(record);
			await vi.advanceTimersByTimeAsync(5000);
		}
		expect(fetcher).toHaveBeenCalledTimes(9);
		expect(exporter.status().circuitOpenUntil).not.toBeNull();
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledTimes(9);
		expect(exporter.status().dropped).toBe(4);
		healthy = true;
		await vi.advanceTimersByTimeAsync(30_000);
		exporter.enqueue(record);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledTimes(10);
		expect(exporter.status().circuitOpenUntil).toBeNull();
		exporter.configure();
	});
});
