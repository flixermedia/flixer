import { validateHttpUrl } from "../config/store/configSchema.js";

export interface UrlInput {
	publicUrl: string;
	appUrl?: string;
	passkeyRpId?: string;
	passkeyOrigins?: string;
}

export interface UrlSettings {
	publicUrl: string;
	appUrl: string;
	passkeyRpId: string;
	passkeyOrigins: string;
}

export type FieldErrors = Record<string, string>;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function clean(value: string | undefined): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * Fills in what can be derived and enforces the WebAuthn rules: origins are plain http(s) origins, https is required
 * except on loopback, and the relying party id must be the host of every origin or a parent domain of it.
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
	const origins = originsRaw ? originsRaw.split(",").map((origin) => origin.trim()).filter(Boolean) : [appUrl.origin];
	const parsed: URL[] = [];
	for (const origin of origins) {
		try {
			const url = new URL(origin);
			if ((url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) || url.origin !== origin) {
				errors.passkeyOrigins = `${origin} must be an https origin without a path (http only for localhost).`;
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
	if (/^[\d.]+$/.test(rpId) && rpId !== "127.0.0.1") {
		errors.passkeyRpId = "Passkeys need a domain name, not an IP address.";
	}
	if (Object.keys(errors).length > 0) {
		return { errors };
	}
	return { values: { publicUrl, appUrl: appUrl.origin + appUrl.pathname.replace(/\/+$/, ""), passkeyRpId: rpId, passkeyOrigins: origins.join(",") } };
}
