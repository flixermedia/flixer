import { BadRequest } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.js";
import { MediaServerError } from "./mediaServerClient.js";

const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const TICKET_LIFETIME_MS = 15 * 60 * 1000;

const SESSION_CONTEXT = "flixer:invites:plex-oauth-session:v1";
const SESSION_AAD = Buffer.from(SESSION_CONTEXT);
const TICKET_CONTEXT = "flixer:invites:plex-oauth-ticket:v1";
const TICKET_AAD = Buffer.from(TICKET_CONTEXT);

interface PlexSessionPayload {
	pinId: number;
	pinCode: string;
	clientId: string;
	inviteCode: string;
	exp: number;
}

export interface PlexAuthTicketPayload {
	plexToken: string;
	plexEmail: string;
	plexUsername: string;
	plexDisplayName: string;
	inviteCode: string;
	exp: number;
}

export interface PlexAuthAccount {
	username: string;
	displayName: string;
	email: string;
	avatarUrl: string | null;
}

export interface PlexAuthStartResult {
	sessionToken: string;
	authUrl: string;
}

export type PlexAuthPollResult = { status: "pending" | "expired" } | { status: "authenticated"; plexAuthTicket: string; account: PlexAuthAccount };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function appProductName(): string {
	return appConfig().get("passkeyRpName") || "Flixer";
}

function oauthKey(context: string): Buffer {
	return deriveAesKey(appConfig().get("appSecret") ?? "", context, "APP_SECRET must be set to at least 32 bytes for Plex sign-in.");
}

function plexHeaders(clientId: string, token?: string): Record<string, string> {
	return {
		Accept: "application/json",
		"X-Plex-Product": appProductName(),
		"X-Plex-Client-Identifier": clientId,
		"X-Plex-Version": "1.0.0",
		"X-Plex-Device": "Web",
		"X-Plex-Platform": "Web",
		...(token ? { "X-Plex-Token": token } : {}),
	};
}

/** Builds the official Plex web sign-in / sign-up URL for a strong OAuth PIN. */
export function buildPlexAuthUrl(clientId: string, pinCode: string, product = appProductName()): string {

	const params = new URLSearchParams({
		clientID: clientId,
		code: pinCode,
		"context[device][product]": product,
	});
	return `https://app.plex.tv/auth#?${params.toString()}`;

}

/** Starts a Plex OAuth PIN session for an invite code and returns the URL to open in a popup window. */
export async function startPlexInviteAuth(inviteCode: string): Promise<PlexAuthStartResult> {

	const clientId = randomUUID();
	let response: Response;
	try {
		response = await fetch("https://plex.tv/api/v2/pins?strong=true", {
			method: "POST",
			headers: plexHeaders(clientId),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new MediaServerError("Could not reach plex.tv to start Plex sign-in.");
	}
	if (!response.ok) {
		throw new MediaServerError(`Could not start Plex sign-in (plex.tv returned status ${response.status}).`);
	}
	const body: unknown = await response.json().catch(() => null);
	const pinId = isRecord(body) && typeof body.id === "number" ? body.id : null;
	const pinCode = isRecord(body) && typeof body.code === "string" ? body.code : null;
	if (!pinId || !pinCode) {
		throw new MediaServerError("plex.tv did not return a valid sign-in PIN.");
	}

	const session: PlexSessionPayload = {
		pinId,
		pinCode,
		clientId,
		inviteCode: inviteCode.toUpperCase(),
		exp: Date.now() + SESSION_LIFETIME_MS,
	};
	const sessionToken = aesGcmEncrypt(JSON.stringify(session), oauthKey(SESSION_CONTEXT), SESSION_AAD);
	return { sessionToken, authUrl: buildPlexAuthUrl(clientId, pinCode) };

}

/** Polls Plex for the PIN's auth token; once authorised, fetches the user's Plex profile and seals it into a short-lived ticket. */
export async function pollPlexInviteAuth(inviteCode: string, sessionToken: string): Promise<PlexAuthPollResult> {

	let session: PlexSessionPayload;
	try {
		session = JSON.parse(aesGcmDecrypt(sessionToken, oauthKey(SESSION_CONTEXT), SESSION_AAD, "This Plex sign-in session is invalid.")) as PlexSessionPayload;
	} catch {
		return { status: "expired" };
	}
	if (session.inviteCode !== inviteCode.toUpperCase() || session.exp <= Date.now()) {
		return { status: "expired" };
	}

	let pinResponse: Response;
	try {
		pinResponse = await fetch(`https://plex.tv/api/v2/pins/${encodeURIComponent(String(session.pinId))}?code=${encodeURIComponent(session.pinCode)}`, {
			headers: plexHeaders(session.clientId),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new MediaServerError("Could not reach plex.tv while checking Plex sign-in.");
	}
	if (pinResponse.status === 404) {
		return { status: "expired" };
	}
	if (!pinResponse.ok) {
		throw new MediaServerError(`Could not check Plex sign-in status (plex.tv returned status ${pinResponse.status}).`);
	}
	const pinBody: unknown = await pinResponse.json().catch(() => null);
	const authToken = isRecord(pinBody) && typeof pinBody.authToken === "string" && pinBody.authToken.trim() ? pinBody.authToken.trim() : null;
	if (!authToken) {
		return { status: "pending" };
	}

	let userResponse: Response;
	try {
		userResponse = await fetch("https://plex.tv/api/v2/user", {
			headers: plexHeaders(session.clientId, authToken),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new MediaServerError("Could not reach plex.tv to read your Plex account details.");
	}
	if (!userResponse.ok) {
		throw new MediaServerError(`Could not read your Plex account details (plex.tv returned status ${userResponse.status}).`);
	}
	const userBody: unknown = await userResponse.json().catch(() => null);
	const email = isRecord(userBody) && typeof userBody.email === "string" ? userBody.email.trim().toLowerCase() : "";
	if (!email) {
		throw new BadRequest("Your Plex account does not have an email address set.");
	}
	const rawUsername = isRecord(userBody) && typeof userBody.username === "string" ? userBody.username.trim() : "";
	const rawTitle = isRecord(userBody) && typeof userBody.title === "string" ? userBody.title.trim() : "";
	const avatarUrl = isRecord(userBody) && typeof userBody.thumb === "string" && userBody.thumb.trim() ? userBody.thumb.trim() : null;
	const username = rawUsername || rawTitle || email.split("@")[0] || "plex-user";
	const displayName = rawTitle || rawUsername || username;

	const ticketPayload: PlexAuthTicketPayload = {
		plexToken: authToken,
		plexEmail: email,
		plexUsername: username,
		plexDisplayName: displayName,
		inviteCode: inviteCode.toUpperCase(),
		exp: Date.now() + TICKET_LIFETIME_MS,
	};
	const plexAuthTicket = aesGcmEncrypt(JSON.stringify(ticketPayload), oauthKey(TICKET_CONTEXT), TICKET_AAD);
	return {
		status: "authenticated",
		plexAuthTicket,
		account: { username, displayName, email, avatarUrl },
	};

}

/** Decrypts and validates a Plex OAuth ticket returned by `pollPlexInviteAuth`. */
export function readPlexAuthTicket(inviteCode: string, ticket: string): PlexAuthTicketPayload {

	let payload: PlexAuthTicketPayload;
	try {
		payload = JSON.parse(aesGcmDecrypt(ticket, oauthKey(TICKET_CONTEXT), TICKET_AAD, "Your Plex sign-in session is invalid. Please sign in with Plex again.")) as PlexAuthTicketPayload;
	} catch {
		throw new BadRequest("Your Plex sign-in session is invalid. Please sign in with Plex again.");
	}
	if (payload.inviteCode !== inviteCode.toUpperCase() || payload.exp <= Date.now() || !payload.plexToken || !payload.plexEmail) {
		throw new BadRequest("Your Plex sign-in session expired. Please sign in with Plex again.");
	}
	return payload;

}
