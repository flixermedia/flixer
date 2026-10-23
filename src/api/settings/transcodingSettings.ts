import { BadRequest } from "@tsed/exceptions";

export const TRANSCODE_HW_ACCEL = ["none", "nvenc", "qsv", "vaapi", "amf"] as const;
export const TRANSCODE_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"] as const;

export const TRANSCODING_SETTING_KEYS = [
	"transcode_hw_accel",
	"transcode_preset",
	"transcode_crf",
	"transcode_threads",
	"transcode_max_bitrate_kbps",
	"transcode_max_concurrent",
];

function integer(key: string, value: unknown, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
		throw new BadRequest(`The ${key} setting must be a whole number from ${min} to ${max}.`);
	}
	return value;
}

/** Rejects values the streamer could not use, so a bad save never breaks playback. */
export function validateTranscodingSetting(key: string, value: unknown): void {
	switch (key) {
		case "transcode_hw_accel":
			if (!(TRANSCODE_HW_ACCEL as readonly unknown[]).includes(value)) {
				throw new BadRequest(`The ${key} setting must be one of: ${TRANSCODE_HW_ACCEL.join(", ")}.`);
			}
			return;
		case "transcode_preset":
			if (!(TRANSCODE_PRESETS as readonly unknown[]).includes(value)) {
				throw new BadRequest(`The ${key} setting must be one of: ${TRANSCODE_PRESETS.join(", ")}.`);
			}
			return;
		case "transcode_crf":
			integer(key, value, 16, 32);
			return;
		case "transcode_threads":
			integer(key, value, 0, 64);
			return;
		case "transcode_max_bitrate_kbps":
			integer(key, value, 0, 500_000);
			return;
		case "transcode_max_concurrent":
			if (value !== null) {
				integer(key, value, 0, 100);
			}
			return;
	}
}
