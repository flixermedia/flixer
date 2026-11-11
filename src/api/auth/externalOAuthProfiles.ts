import { BadRequest, ServiceUnavailable } from "@tsed/exceptions";
import { isIP } from "node:net";
import { appConfig } from "../../config/store/appConfig.js";
import { isPublicRepositoryAddress } from "../plugins/pluginRepositoryClient.js";

export interface ExternalOAuthProfileSettings {
	authorizationUrl: string;
	tokenUrl: string;
	userInfoUrl: string;
	issuer: string;
	subjectField: string;
	scope: string;
	clientId: string;
	tokenAuthMethod: "client_secret_post" | "client_secret_basic" | "none";
}

function safeUrl(value: unknown): string {
	if (typeof value !== "string" || value.length > 2048) throw new BadRequest("OAuth endpoint must be a valid HTTPS URL.");
	let url: URL;
	try { url = new URL(value); } catch { throw new BadRequest("OAuth endpoint must be a valid HTTPS URL."); }
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") || hostname === "localhost" || hostname.endsWith(".localhost") || (isIP(hostname) && !isPublicRepositoryAddress(hostname))) {
		throw new BadRequest("OAuth endpoint must be a public HTTPS URL.");
	}
	return url.toString();
}

function requiredText(value: unknown, name: string, limit: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new BadRequest(`Invalid OAuth ${name}.`);
	return value.trim();
}

export function validateOAuthProfileSettings(input: unknown): ExternalOAuthProfileSettings {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequest("Invalid OAuth provider configuration.");
	const value = input as Record<string, unknown>;
	const subjectField = requiredText(value.subjectField, "subject field", 128);
	if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(subjectField)) throw new BadRequest("Invalid OAuth subject field.");
	const tokenAuthMethod = value.tokenAuthMethod;
	if (tokenAuthMethod !== "client_secret_post" && tokenAuthMethod !== "client_secret_basic" && tokenAuthMethod !== "none") throw new BadRequest("Invalid OAuth token authentication method.");
	const authorizationUrl = safeUrl(value.authorizationUrl);
	const authorization = new URL(authorizationUrl);
	if (["state", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "client_id", "scope"].some((key) => authorization.searchParams.has(key))) throw new BadRequest("OAuth authorization URL cannot contain reserved parameters.");
	const issuer = safeUrl(value.issuer);
	if (issuer.length > 512) throw new BadRequest("Invalid OAuth issuer.");
	return {
		authorizationUrl,
		tokenUrl: safeUrl(value.tokenUrl),
		userInfoUrl: safeUrl(value.userInfoUrl),
		issuer,
		subjectField,
		scope: requiredText(value.scope, "scope", 1024),
		clientId: requiredText(value.clientId, "client ID", 256),
		tokenAuthMethod,
	};
}

export function oauthCallbackUrl(): string {
	const configured = appConfig().get("appUrl") || appConfig().get("publicUrl");
	if (!configured) throw new ServiceUnavailable("The public application URL must be configured for external sign-in.");
	let url: URL;
	try { url = new URL(configured); } catch { throw new ServiceUnavailable("The public application URL is invalid."); }
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && local))) throw new ServiceUnavailable("External sign-in requires a secure application URL.");
	return new URL("/auth/provider-callback", url).toString();
}

export function oauthProfileId(pluginId: string, profileId: string): string {
	return `${pluginId}~${profileId}`;
}

export function splitOAuthProfileId(id: string): { pluginId: string; profileId: string } | null {
	const match = /^([a-z0-9]+(?:[.-][a-z0-9]+)*)~([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(id);
	return match && match[1]!.length <= 128 ? { pluginId: match[1]!, profileId: match[2]! } : null;
}