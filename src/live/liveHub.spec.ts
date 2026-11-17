import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveHub } from "./liveHub.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("LiveHub", () => {
	let hub: LiveHub;
	afterEach(() => hub?.close());

	it("loads once for several subscribers and replays the current data to late ones", async () => {
		hub = new LiveHub();
		const load = vi.fn(async () => ({ n: 1 }));
		hub.define("streams", { intervalMs: 60_000, load });

		const first = vi.fn();
		const second = vi.fn();
		hub.subscribe("streams", { sessionId: "a" }, first);
		await flush();
		hub.subscribe("streams", { sessionId: "b" }, second);

		expect(load).toHaveBeenCalledTimes(1);
		expect(first).toHaveBeenCalledWith("streams", { n: 1 });
		expect(second).toHaveBeenCalledWith("streams", { n: 1 });
	});

	it("only pushes when the data changed", async () => {
		hub = new LiveHub();
		let value = 1;
		hub.define("overview", { intervalMs: 60_000, load: async () => ({ value }) });
		const listener = vi.fn();
		hub.subscribe("overview", { sessionId: "a" }, listener);
		await flush();

		hub.invalidate("overview");
		await flush();
		expect(listener).toHaveBeenCalledTimes(1);

		value = 2;
		hub.invalidate("overview");
		await flush();
		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenLastCalledWith("overview", { value: 2 });
	});

	it("stops reading once the last subscriber leaves", async () => {
		hub = new LiveHub();
		const load = vi.fn(async () => ({}));
		hub.define("shares", { intervalMs: 5, load });
		const unsubscribe = hub.subscribe("shares", { sessionId: "a" }, () => {});
		await flush();
		unsubscribe();
		const calls = load.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(load.mock.calls.length).toBe(calls);
	});

	it("keeps per-session topics separate", async () => {
		hub = new LiveHub();
		hub.define("devices", { intervalMs: 60_000, perSession: true, load: async ({ sessionId }) => ({ current: sessionId }) });
		const a = vi.fn();
		const b = vi.fn();
		hub.subscribe("devices", { sessionId: "a" }, a);
		hub.subscribe("devices", { sessionId: "b" }, b);
		await flush();

		expect(a).toHaveBeenCalledWith("devices", { current: "a" });
		expect(b).toHaveBeenCalledWith("devices", { current: "b" });
	});
});
