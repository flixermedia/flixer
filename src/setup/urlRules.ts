import { validateHttpUrl } from "../config/store/configSchema.js";

interface UrlInput {
	publicUrl: string;
	appUrl?: string;
	passkeyRpId?: string;
	passkeyOrigins?: string;
}

interface UrlSettings {
	publicUrl: string;
	appUrl: string;
	passkeyRpId: string;
	passkeyOrigins: string;
}

export type FieldErrors = Record<string, string>;

function clean(value: string | undefined): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * Fills in what can be derived for public and app URLs. Accepts both HTTP and HTTPS origins for all installations.
 */
export function resolveUrls(input: UrlInput): { values: UrlSettings } | { errors: FieldErrors } {

	const errors: FieldErrors = {};
	const publicProblem = clean(input.publicUrl) ? validateHttpUrl(clean(input.publicUrl)) : "Required.";
	if (publicProblem) {
		errors.publicUrl = publicProblem;
	}
	const appRaw = clean(input.appUrl) || clean(input.publicUrl);
	const appProblem = appRaw ? validateHttpUrl(appRaw) : "Required.";
	if (appProblem) {
		errors.appUrl = appProblem;
	}
	if (Object.keys(errors).length > 0) {
		return { errors };
	}

	const publicUrl = clean(input.publicUrl).replace(/\/+$/, "");
	const appUrl = new URL(appRaw);
	const originsRaw = clean(input.passkeyOrigins);
	const origins = originsRaw
		? originsRaw
				.split(",")
				.map((origin) => origin.trim())
				.filter(Boolean)
		: [appUrl.origin];
	const parsed: URL[] = [];
	for (const origin of origins) {
		try {
			const url = new URL(origin);
			if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== origin) {
				errors.passkeyOrigins = `${origin} must be an http or https origin without a path.`;
			}
			parsed.push(url);
		} catch {
			errors.passkeyOrigins = `${origin} is not a valid origin.`;
		}
	}
	const rpId = (clean(input.passkeyRpId) || appUrl.hostname).toLowerCase();
	if (!errors.passkeyOrigins && parsed.some((url) => url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`))) {
		errors.passkeyRpId = `Must be the host of every passkey origin or a parent domain of it (${rpId} is not).`;
	}
	if (Object.keys(errors).length > 0) {
		return { errors };
	}
	return { values: { publicUrl, appUrl: appUrl.origin + appUrl.pathname.replace(/\/+$/, ""), passkeyRpId: rpId, passkeyOrigins: origins.join(",") } };

}
