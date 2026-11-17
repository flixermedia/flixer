import { LogContext, LogEvent, levels } from "@tsed/logger";
import { describe, expect, it } from "vitest";
import { toUnifiedRecord } from "./unifiedLog.js";

describe("unified log records", () => {
	function record(data: unknown[]) {
		return toUnifiedRecord(new LogEvent("test", levels().INFO, data, new LogContext()));
	}

	it("uses a structured message while preserving other fields", () => {
		expect(record([{ event: "REQUEST_DONE", message: "Request complete.", trace_id: "abc" }])).toMatchObject({
			message: "Request complete.",
			event: "REQUEST_DONE",
			trace_id: "abc",
		});
	});

	it("prefers positional text and falls back to the event when the structured message is empty", () => {
		expect(record(["positional text", { event: "REQUEST_DONE", message: "structured text" }]).message).toBe("positional text");
		expect(record([{ event: "REQUEST_DONE", message: " " }]).message).toBe("REQUEST_DONE");
	});

	it("bounds and removes terminal escapes from structured messages", () => {
		const message = record([{ event: "LONG", message: `\u001b[31m${"x".repeat(4_001)}\u001b[0m` }]).message;
		expect(message).toHaveLength(4_001);
		expect(message).not.toContain("\u001b");
		expect(message.endsWith("…")).toBe(true);
	});
});
