import { BadRequest } from "@tsed/exceptions";

export const REQUEST_SETTING_KEYS = [
	"requests_enabled",
	"requests_auto_approve",
	"requests_movies_enabled",
	"requests_tv_enabled",
	"requests_music_enabled",
	"requests_quota_limit",
	"requests_quota_days",
	"requests_default_can_request",
	"requests_notify_admins",
	"requests_notify_users",
] as const;

export interface RequestSettings {
	enabled: boolean;
	autoApprove: boolean;
	movies: boolean;
	tv: boolean;
	music: boolean;
	/** 0 means unlimited. */
	quotaLimit: number;
	quotaDays: number;
	defaultCanRequest: boolean;
	notifyAdmins: boolean;
	notifyUsers: boolean;
}

export const MAX_QUOTA_LIMIT = 1000;
export const MAX_QUOTA_DAYS = 365;

/** Builds the typed settings from the stored key/value pairs, falling back to the defaults. */
export function parseRequestSettings(values: Map<string, unknown>): RequestSettings {

	const flag = (key: string, fallback: boolean) =>
		typeof values.get(key) === "boolean" ? (values.get(key) as boolean) : fallback;
	const count = (key: string, fallback: number) => {
		const value = values.get(key);
		return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
	};
	return {
		enabled: flag("requests_enabled", false),
		autoApprove: flag("requests_auto_approve", false),
		movies: flag("requests_movies_enabled", true),
		tv: flag("requests_tv_enabled", true),
		music: flag("requests_music_enabled", true),
		quotaLimit: count("requests_quota_limit", 0),
		quotaDays: Math.max(1, count("requests_quota_days", 7)),
		defaultCanRequest: flag("requests_default_can_request", true),
		notifyAdmins: flag("requests_notify_admins", true),
		notifyUsers: flag("requests_notify_users", true),
	};

}

export function validateRequestSetting(key: string, value: unknown): void {

	if (key === "requests_quota_limit") {
		if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_QUOTA_LIMIT) {
			throw new BadRequest(`The ${key} setting must be a whole number from 0 (unlimited) to ${MAX_QUOTA_LIMIT}.`);
		}
	} else if (key === "requests_quota_days") {
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_QUOTA_DAYS) {
			throw new BadRequest(`The ${key} setting must be a whole number of days from 1 to ${MAX_QUOTA_DAYS}.`);
		}
	} else if (typeof value !== "boolean") {
		throw new BadRequest(`The ${key} setting must be a boolean.`);
	}

}
