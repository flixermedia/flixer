import { describe, expect, it } from "vitest";
import { validateTranscodingSetting } from "./transcodingSettings.js";

describe("validateTranscodingSetting", () => {
	it("accepts valid values", () => {
		expect(() => validateTranscodingSetting("transcode_hw_accel", "nvenc")).not.toThrow();
		expect(() => validateTranscodingSetting("transcode_preset", "slow")).not.toThrow();
		expect(() => validateTranscodingSetting("transcode_crf", 28)).not.toThrow();
		expect(() => validateTranscodingSetting("transcode_max_concurrent", null)).not.toThrow();
	});

	it("rejects values the streamer cannot use", () => {
		expect(() => validateTranscodingSetting("transcode_hw_accel", "cuda")).toThrow();
		expect(() => validateTranscodingSetting("transcode_preset", "placebo")).toThrow();
		expect(() => validateTranscodingSetting("transcode_crf", 10)).toThrow();
		expect(() => validateTranscodingSetting("transcode_crf", 23.5)).toThrow();
		expect(() => validateTranscodingSetting("transcode_threads", -1)).toThrow();
		expect(() => validateTranscodingSetting("transcode_max_concurrent", "2")).toThrow();
	});
});
