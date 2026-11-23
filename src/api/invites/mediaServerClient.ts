import { logger } from "@tsed/di";
import type { InviteServerType } from "../../entities/inviteServer.entity.js";

const REQUEST_TIMEOUT_MS = 15_000;

export interface ExternalAccountRequest {
	username: string;
	password: string;
	email: string;
	/** Jellyfin/Emby folder ids or Plex section ids; empty grants everything. */
	libraryIds: string[];
	allowDownloads: boolean;
	/** When true, Jellyfin/Emby accounts are created disabled until the user verifies their email. */
	disabled?: boolean;
	/** The invited user's Plex OAuth token when they signed in with Plex; used to auto-accept the server share. */
	plexUserToken?: string;
	/** When true and plexUserToken is available, opts the Plex user out of Plex's built-in online media sources. */
	disableOnlineMediaSources?: boolean;
}

export interface ExternalAccountResult {
	/** The account id on Jellyfin/Emby, or shared_server id on Plex when returned. */
	externalUserId: string | null;
	/** The address a Plex invite was sent to; null otherwise. */
	invitedEmail: string | null;
	/** True when a Plex server share was automatically accepted on the user's behalf via Plex OAuth. */
	inviteAccepted?: boolean;
}

export interface ExternalAccountIdentity {
	externalUserId: string | null;
	externalEmail: string | null;
	username: string;
}

export interface ExternalAccountSummary {
	id: string;
	username: string | null;
	email: string | null;
}

export class MediaServerError extends Error {}

const PLEX_CLIENT_ID = "flixer-invites";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

async function request(url: string, init: RequestInit, failure: string): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	} catch {
		throw new MediaServerError(`${failure}: the server could not be reached.`);
	}
	if (response.status === 401 || response.status === 403) {
		throw new MediaServerError(`${failure}: the server rejected the saved API key (status ${response.status}).`);
	}
	if (!response.ok) {
		throw new MediaServerError(`${failure}: the server answered with status ${response.status}.`);
	}
	return response;
}

// ---- Jellyfin / Emby -------------------------------------------------------------------------------------------

/**
 * Jellyfin 12 removed the legacy `X-Emby-Token` header, accepting only the `MediaBrowser`
 * authorization scheme; Emby and older Jellyfin still accept the legacy header, so both are sent.
 */
function jellyfinAuthHeaders(apiKey: string): Record<string, string> {
	const token = apiKey.replaceAll('"', "");
	return {
		"X-Emby-Token": apiKey,
		Authorization: `MediaBrowser Token="${token}", Client="Flixer", Device="Flixer", DeviceId="flixer-invites", Version="1.0.0"`,
	};
}

/** Creates a user and applies the invite's library and download policy. Jellyfin and Emby share this API. */
async function createJellyfinUser(baseUrl: string, apiKey: string, account: ExternalAccountRequest): Promise<ExternalAccountResult> {
	const headers = { "Content-Type": "application/json", ...jellyfinAuthHeaders(apiKey) };
	const created = await request(`${normalizeUrl(baseUrl)}/Users/New`, { method: "POST", headers, body: JSON.stringify({ Name: account.username, Password: account.password }) }, "The account could not be created on the media server");
	const body: unknown = await created.json().catch(() => null);
	const userId = isRecord(body) && typeof body.Id === "string" ? body.Id : null;
	if (!userId) {
		throw new MediaServerError("The media server did not return the new account's id.");
	}

	// The policy endpoint replaces the whole policy and treats missing booleans as false, so the
	// server's defaults are read back and only the invite's fields are changed.
	const current = isRecord(body) && isRecord(body.Policy) ? body.Policy : {};
	const policy = {
		...current,
		IsAdministrator: false,
		IsDisabled: Boolean(account.disabled),
		EnableAllFolders: account.libraryIds.length === 0,
		EnabledFolders: account.libraryIds,
		EnableContentDownloading: account.allowDownloads,
	};
	await request(`${normalizeUrl(baseUrl)}/Users/${encodeURIComponent(userId)}/Policy`, { method: "POST", headers, body: JSON.stringify(policy) }, "The account was created but its library access could not be set");

	return { externalUserId: userId, invitedEmail: null };
}

/** Enables or disables an existing Jellyfin or Emby user account while preserving the rest of its policy. */
async function setJellyfinUserDisabled(baseUrl: string, apiKey: string, userId: string, disabled: boolean): Promise<void> {
	const headers = { "Content-Type": "application/json", ...jellyfinAuthHeaders(apiKey) };
	const existing = await request(`${normalizeUrl(baseUrl)}/Users/${encodeURIComponent(userId)}`, { headers: jellyfinAuthHeaders(apiKey) }, "Could not load the media server account");
	const body: unknown = await existing.json().catch(() => null);
	const current = isRecord(body) && isRecord(body.Policy) ? body.Policy : {};
	await request(`${normalizeUrl(baseUrl)}/Users/${encodeURIComponent(userId)}/Policy`, { method: "POST", headers, body: JSON.stringify({ ...current, IsDisabled: disabled }) }, disabled ? "Could not disable the media server account" : "Could not enable the media server account");
}

/** Confirms the URL and API key work by asking for the server's system info with the key attached. */
async function testJellyfin(baseUrl: string, apiKey: string): Promise<void> {
	const response = await request(`${normalizeUrl(baseUrl)}/System/Info`, { headers: jellyfinAuthHeaders(apiKey) }, "The connection test failed");
	await response.body?.cancel();
}

/** Lists all user accounts on a Jellyfin or Emby server. */
async function listJellyfinUsers(baseUrl: string, apiKey: string): Promise<ExternalAccountSummary[]> {
	const response = await request(`${normalizeUrl(baseUrl)}/Users`, { headers: jellyfinAuthHeaders(apiKey) }, "Could not list accounts on the media server");
	const body: unknown = await response.json().catch(() => null);
	if (!Array.isArray(body)) {
		throw new MediaServerError("The media server returned an unexpected user list.");
	}
	const accounts: ExternalAccountSummary[] = [];
	for (const entry of body) {
		if (!isRecord(entry) || typeof entry.Id !== "string") continue;
		accounts.push({ id: entry.Id, username: typeof entry.Name === "string" ? entry.Name : null, email: null });
	}
	return accounts;
}

/** Deletes a user from Jellyfin or Emby; treats 404 as already deleted. */
async function deleteJellyfinUser(baseUrl: string, apiKey: string, account: ExternalAccountIdentity): Promise<void> {
	let targetId = account.externalUserId;
	if (!targetId) {
		const users = await listJellyfinUsers(baseUrl, apiKey);
		const match = users.find((entry) => entry.username?.toLowerCase() === account.username.toLowerCase());
		targetId = match?.id ?? null;
	}
	if (!targetId) {
		return;
	}
	let response: Response;
	try {
		response = await fetch(`${normalizeUrl(baseUrl)}/Users/${encodeURIComponent(targetId)}`, {
			method: "DELETE",
			headers: jellyfinAuthHeaders(apiKey),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new MediaServerError("Could not remove the account from the media server: the server could not be reached.");
	}
	if (response.status === 404) {
		return;
	}
	if (response.status === 401 || response.status === 403) {
		throw new MediaServerError(`Could not remove the account from the media server: the server rejected the saved API key (status ${response.status}).`);
	}
	if (!response.ok) {
		throw new MediaServerError(`Could not remove the account from the media server: the server answered with status ${response.status}.`);
	}
}

// ---- Plex ------------------------------------------------------------------------------------------------------

/** Minimum Plex Media Server version required by plex.tv to issue valid shared-user access tokens. */
export const MIN_SUPPORTED_PLEX_VERSION = "1.43.3.10861";

/** Compares dotted numeric Plex version strings (ignoring trailing commit hashes like `-5bce000f7`). */
export function comparePlexVersions(left: string, right: string): number {
	const parse = (value: string) =>
		value
			.trim()
			.split("-")[0]
			.split(".")
			.map((part) => Number.parseInt(part, 10))
			.map((num) => (Number.isFinite(num) ? num : 0));
	const a = parse(left);
	const b = parse(right);
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const diff = (a[index] ?? 0) - (b[index] ?? 0);
		if (diff !== 0) return diff > 0 ? 1 : -1;
	}
	return 0;
}

/** Reads the server's machine identifier and version from `/identity`. */
async function plexIdentity(baseUrl: string, token: string | null): Promise<{ machineIdentifier: string; version: string | null }> {
	const headers: Record<string, string> = { Accept: "application/json" };
	if (token) headers["X-Plex-Token"] = token;
	const response = await request(`${normalizeUrl(baseUrl)}/identity`, { headers }, "The Plex server could not be reached");
	const body: unknown = await response.json().catch(() => null);
	const container = isRecord(body) && isRecord(body.MediaContainer) ? body.MediaContainer : null;
	const machineIdentifier = container && typeof container.machineIdentifier === "string" ? container.machineIdentifier : null;
	const version = container && typeof container.version === "string" && container.version.trim() ? container.version.trim() : null;
	if (!machineIdentifier) {
		throw new MediaServerError("The Plex server did not report its machine identifier.");
	}
	return { machineIdentifier, version };
}

/** Reads the server's machine identifier, which plex.tv needs to address the share. */
async function plexMachineIdentifier(baseUrl: string, token: string): Promise<string> {
	return (await plexIdentity(baseUrl, token)).machineIdentifier;
}

/**
 * Verifies the Plex Media Server is reachable, runs at least `MIN_SUPPORTED_PLEX_VERSION`, and is
 * not flagged by plex.tv with `SERVER_NOT_SUPPORTED` for shared users.
 */
export async function validatePlexServerVersion(baseUrl: string, token: string | null): Promise<{ machineIdentifier: string; version: string | null }> {
	const identity = await plexIdentity(baseUrl, token);
	if (identity.version && comparePlexVersions(identity.version, MIN_SUPPORTED_PLEX_VERSION) < 0) {
		throw new MediaServerError(`This Plex Media Server is running version ${identity.version}, which is out of date and blocked by plex.tv for shared users. Update Plex Media Server to version ${MIN_SUPPORTED_PLEX_VERSION} or newer and try again.`);
	}
	if (token) {
		let response: Response;
		try {
			response = await fetch(`https://plex.tv/api/servers/${encodeURIComponent(identity.machineIdentifier)}/shared_servers`, {
				headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, Accept: "application/xml" },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new MediaServerError("Could not verify this Plex server with plex.tv.");
		}
		if (response.status === 401 || response.status === 403) {
			throw new MediaServerError(`The Plex token was rejected by plex.tv (status ${response.status}).`);
		}
		if (response.ok) {
			const xml = await response.text();
			if (/accessToken="SERVER_NOT_SUPPORTED"/i.test(xml)) {
				throw new MediaServerError(`plex.tv is blocking shared access for this Plex Media Server${identity.version ? ` (version ${identity.version})` : ""} with "SERVER_NOT_SUPPORTED". Update Plex Media Server to the latest version and try again.`);
			}
		}
	}
	return identity;
}

function xmlAttribute(tag: string, name: string): string | null {
	const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
	return match?.[1] ? match[1] : null;
}

/** Parses Plex's shared_servers XML response into account summaries (covers both active shares and pending invites). */
export function parsePlexSharedServersXml(xml: string): ExternalAccountSummary[] {
	if (!/<MediaContainer\b/i.test(xml)) {
		throw new MediaServerError("Plex returned an unexpected shared servers response.");
	}
	const accounts: ExternalAccountSummary[] = [];
	for (const match of xml.matchAll(/<SharedServer\b[^>]*>/gi)) {
		const tag = match[0];
		const id = xmlAttribute(tag, "id");
		if (!id) continue;
		accounts.push({
			id,
			username: xmlAttribute(tag, "username"),
			email: xmlAttribute(tag, "email"),
		});
	}
	return accounts;
}

async function listPlexShares(baseUrl: string, token: string): Promise<{ machineIdentifier: string; shares: ExternalAccountSummary[] }> {
	const machineIdentifier = await plexMachineIdentifier(baseUrl, token);
	const response = await request(`https://plex.tv/api/servers/${encodeURIComponent(machineIdentifier)}/shared_servers`, { headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, Accept: "application/xml" } }, "Could not list shared Plex users");
	const xml = await response.text();
	return { machineIdentifier, shares: parsePlexSharedServersXml(xml) };
}

interface PlexOwnerIdentity {
	id: string | null;
	uuid: string | null;
	email: string | null;
	username: string | null;
}

const DEFAULT_PLEX_ONLINE_SOURCE_KEYS = ["includeDiscoverSource", "includeMetadataInSearch", "includeAvailabilities", "includeSocialProof", "tv.plex.provider.vod", "tv.plex.provider.epg", "tv.plex.provider.webshows", "tv.plex.provider.news", "tv.plex.provider.podcasts", "tv.plex.provider.music"];

const PLEX_WEB_PRODUCT = "Plex Web";
const PLEX_DISCOVER_WHATS_NEW_ID = "fd9f56d8-8858-490d-aede-05c29b06d584";
const PLEX_AUTO_PINNED_CLOUD_PROVIDERS = ["myPlex--tv.plex.provider.discover--home", "myPlex--tv.plex.provider.discover--watchlist", "myPlex--tv.plex.provider.vod--movies", "myPlex--tv.plex.provider.vod--store", "myPlex--tv.plex.provider.epg--home", "myPlex--tv.plex.provider.music--home"];

async function plexUserIdentity(token: string): Promise<PlexOwnerIdentity | null> {
	try {
		const response = await fetch("https://plex.tv/api/v2/user", {
			headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, Accept: "application/json" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const body: unknown = await response.json().catch(() => null);
		if (!isRecord(body)) return null;
		return {
			id: typeof body.id === "number" || typeof body.id === "string" ? String(body.id) : null,
			uuid: typeof body.uuid === "string" && body.uuid.trim() ? body.uuid.trim() : null,
			email: typeof body.email === "string" ? body.email.trim().toLowerCase() : null,
			username: typeof body.username === "string" ? body.username.trim().toLowerCase() : null,
		};
	} catch {
		return null;
	}
}

export interface PlexServerSection {
	id: number;
	key: string;
	type: string;
	title: string;
}

export interface PlexServerInfo {
	friendlyName: string;
	sections: PlexServerSection[];
}

/** Parses Plex's server XML (<Server name="..."><Section id="..." key="..." type="..." title="..."/></Server>). */
export function parsePlexServerXml(xml: string): PlexServerInfo {
	const serverTag = /<Server\b[^>]*>/i.exec(xml)?.[0] ?? "";
	const friendlyName = xmlAttribute(serverTag, "name") ?? "Plex";
	const sections: PlexServerSection[] = [];
	for (const match of xml.matchAll(/<Section\b[^>]*>/gi)) {
		const tag = match[0];
		const rawId = xmlAttribute(tag, "id");
		const key = xmlAttribute(tag, "key") ?? "";
		const type = xmlAttribute(tag, "type") ?? "movie";
		const title = xmlAttribute(tag, "title") ?? "";
		const id = rawId ? Number.parseInt(rawId, 10) : Number.NaN;
		if (Number.isInteger(id)) {
			sections.push({ id, key, type, title });
		}
	}
	return { friendlyName, sections };
}

/** Parses Plex's server XML into section summaries. */
export function parsePlexServerSectionsXml(xml: string): PlexServerSection[] {
	return parsePlexServerXml(xml).sections;
}

async function fetchPlexServerInfo(machineIdentifier: string, token: string): Promise<PlexServerInfo> {
	try {
		const response = await fetch(`https://plex.tv/api/servers/${encodeURIComponent(machineIdentifier)}`, {
			headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, Accept: "application/xml" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (response.ok) {
			return parsePlexServerXml(await response.text());
		}
	} catch {
		// Return empty fallback below.
	}
	return { friendlyName: "Plex", sections: [] };
}

/** Resolves admin-supplied library identifiers (local PMS keys, cloud section IDs, or titles) into Plex cloud section IDs. */
function resolvePlexLibrarySectionIds(sections: PlexServerSection[], requestedIds: string[]): number[] {
	const cleaned = requestedIds.map((value) => value.trim()).filter(Boolean);
	if (cleaned.length === 0) return [];

	const resolved = new Set<number>();
	for (const entry of cleaned) {
		const byId = sections.find((section) => String(section.id) === entry);
		if (byId) {
			resolved.add(byId.id);
			continue;
		}
		const byKey = sections.find((section) => section.key === entry);
		if (byKey) {
			resolved.add(byKey.id);
			continue;
		}
		const byTitle = sections.find((section) => section.title.toLowerCase() === entry.toLowerCase());
		if (byTitle) {
			resolved.add(byTitle.id);
			continue;
		}
		const parsed = Number.parseInt(entry, 10);
		if (Number.isInteger(parsed)) {
			resolved.add(parsed);
		}
	}
	return [...resolved];
}

function plexPinnedSourceType(sectionType: string): string {
	switch (sectionType.toLowerCase()) {
		case "movie":
			return "movies";
		case "show":
			return "tv";
		case "artist":
			return "music";
		case "photo":
			return "photos";
		default:
			return sectionType.toLowerCase();
	}
}

/**
 * Pins the shared server's libraries to the invited user's Plex Web sidebar and Home screen via
 * Plex's cloud-synced `experience` user setting (`clients.plex.tv/api/v2/user/settings?sharedSettings=1`).
 *
 * Plex scopes `sharedSettings=1` by `X-Plex-Product`, so this uses `"Plex Web"` (shared by both
 * `app.plex.tv` and self-hosted Plex Web) and marks Plex's built-in Discover/Watchlist/VOD/EPG
 * providers as already processed in `autoPinnedProviders` so Plex Web will not auto-pin them.
 */
async function pinPlexLibrariesForUser(userToken: string, machineIdentifier: string, serverInfo: PlexServerInfo, sharedSectionIds: number[], removeOnlineSources: boolean): Promise<void> {
	const targetSections = sharedSectionIds.length > 0 ? serverInfo.sections.filter((section) => sharedSectionIds.includes(section.id)) : serverInfo.sections;
	if (targetSections.length === 0) return;

	const headers = {
		"X-Plex-Token": userToken,
		"X-Plex-Client-Identifier": PLEX_CLIENT_ID,
		"X-Plex-Product": PLEX_WEB_PRODUCT,
		Accept: "application/json",
		"Content-Type": "application/json",
	};

	let experience: Record<string, unknown> = { autoHomeHubsEnabled: true, schemaVersion: 12 };
	try {
		const currentRes = await fetch("https://clients.plex.tv/api/v2/user?includeSettings=1&includeSharedSettings=1", {
			headers,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (currentRes.ok) {
			const payload: unknown = await currentRes.json().catch(() => null);
			const list = isRecord(payload) && Array.isArray(payload.settings) ? payload.settings : Array.isArray(payload) ? payload : [];
			const entry = list.find((item) => isRecord(item) && item.id === "experience");
			if (entry && isRecord(entry) && typeof entry.value === "string") {
				const parsed: unknown = JSON.parse(entry.value);
				if (isRecord(parsed)) {
					experience = { ...parsed };
				}
			}
		}
	} catch {
		// Proceed with default experience object.
	}

	const newPins = targetSections
		.filter((section) => Boolean(section.key))
		.map((section) => {
			const sourceType = plexPinnedSourceType(section.type);
			return {
				key: `source--${sourceType}--${machineIdentifier}--com.plexapp.plugins.library--${section.key}`,
				sourceType,
				machineIdentifier,
				providerIdentifier: "com.plexapp.plugins.library",
				directoryID: section.key,
				title: section.title,
				serverFriendlyName: serverInfo.friendlyName,
				serverSourceTitle: null,
				isCloud: false,
				isFullOwnedServer: false,
				isHidden: false,
			};
		});
	if (newPins.length === 0) return;

	const newKeys = new Set(newPins.map((pin) => pin.key));
	const existingSidebar = isRecord(experience.sidebarSettings) ? experience.sidebarSettings : {};
	const existingPins = Array.isArray(existingSidebar.pinnedSources) ? existingSidebar.pinnedSources : [];
	const retainedPins = existingPins.filter((pin) => {
		if (!isRecord(pin) || typeof pin.key !== "string") return false;
		if (newKeys.has(pin.key)) return false;
		if (removeOnlineSources) {
			if (pin.isCloud === true || pin.machineIdentifier === "myPlex") return false;
			if (typeof pin.providerIdentifier === "string" && pin.providerIdentifier.startsWith("tv.plex.provider.")) return false;
			if (pin.sourceType === "discover" || pin.sourceType === "watchlist") return false;
		}
		return true;
	});

	if (removeOnlineSources) {
		const existingAutoPinned = Array.isArray(experience.autoPinnedProviders) ? experience.autoPinnedProviders.filter((entry): entry is string => typeof entry === "string") : [];
		experience.autoPinnedProviders = [...new Set([...existingAutoPinned, ...PLEX_AUTO_PINNED_CLOUD_PROVIDERS])];

		const existingDismissed = isRecord(experience.dismissedWhatsNewFeatures) ? experience.dismissedWhatsNewFeatures : {};
		experience.dismissedWhatsNewFeatures = { ...existingDismissed, [PLEX_DISCOVER_WHATS_NEW_ID]: true };

		if (isRecord(experience.lastSourcePivots)) {
			const cleanedPivots: Record<string, unknown> = {};
			for (const [pivotKey, pivotValue] of Object.entries(experience.lastSourcePivots)) {
				if (!pivotKey.includes("tv.plex.provider.")) {
					cleanedPivots[pivotKey] = pivotValue;
				}
			}
			experience.lastSourcePivots = cleanedPivots;
		}
	}

	const existingHome = isRecord(experience.homeSettings) ? experience.homeSettings : {};
	experience.autoHomeHubsEnabled = true;
	if (typeof experience.schemaVersion !== "number") {
		experience.schemaVersion = 12;
	}
	experience.homeSettings = {
		...existingHome,
		hasCustomizations: false,
		hasSeededPreferredServerContent: true,
		hasSeededProviderPromotedContent: true,
		preferredServerID: machineIdentifier,
		version: typeof existingHome.version === "number" ? existingHome.version : 1,
		hubs: Array.isArray(existingHome.hubs) ? existingHome.hubs : [],
	};
	experience.sidebarSettings = {
		...existingSidebar,
		hasCompletedSetup: true,
		pinnedSources: [...newPins, ...retainedPins],
	};

	try {
		const saved = await fetch("https://clients.plex.tv/api/v2/user/settings?sharedSettings=1", {
			method: "POST",
			headers,
			body: JSON.stringify({
				value: JSON.stringify([{ id: "experience", type: "json", value: JSON.stringify(experience), hidden: true }]),
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!saved.ok) {
			logger().warn(`Could not pin Plex libraries to user home screen (status ${saved.status}).`);
		}
	} catch (error) {
		logger().warn("Could not save Plex pinned libraries setting.", error);
	}
}

/** Best-effort opt-out of Plex's built-in Discover, Watchlist search metadata, and ad-supported online media sources for a newly invited Plex user. */
async function disablePlexOnlineMediaSources(userToken: string): Promise<void> {
	const identity = await plexUserIdentity(userToken);
	if (!identity?.uuid) return;
	const headers = { "X-Plex-Token": userToken, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, Accept: "application/json" };
	const keys = new Set<string>(DEFAULT_PLEX_ONLINE_SOURCE_KEYS);
	try {
		const current = await fetch(`https://plex.tv/api/v2/user/${encodeURIComponent(identity.uuid)}/settings/opt_outs`, {
			headers,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (current.ok) {
			const data: unknown = await current.json().catch(() => null);
			if (Array.isArray(data)) {
				for (const entry of data) {
					if (isRecord(entry) && typeof entry.key === "string" && entry.key.startsWith("tv.plex.provider.")) {
						keys.add(entry.key);
					}
				}
			} else if (isRecord(data)) {
				for (const key of Object.keys(data)) {
					if (key.startsWith("tv.plex.provider.")) {
						keys.add(key);
					}
				}
			}
		}
	} catch {
		// Fall back to default provider and Discover opt-out keys.
	}

	await Promise.all(
		[...keys].map(async (key) => {
			try {
				await fetch(`https://plex.tv/api/v2/user/${encodeURIComponent(identity.uuid!)}/settings/opt_outs?key=${encodeURIComponent(key)}&value=opt_out`, {
					method: "POST",
					headers,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
			} catch {
				// Ignore individual opt-out failures so invite acceptance is never blocked.
			}
		}),
	);
}

async function tryAcceptPlexInviteOnce(machineIdentifier: string, sharedServerId: string | null, owner: PlexOwnerIdentity | null, userToken: string): Promise<boolean> {
	let acceptedAny = false;
	const baseHeaders = { "X-Plex-Token": userToken, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, "X-Plex-Product": "Flixer" };

	// 1. Primary: plex.tv/api/invites/requests (incoming received friend, server, and Plex Home invites — used by python-plexapi / Wizarr).
	try {
		const requests = await fetch("https://plex.tv/api/invites/requests", {
			headers: { ...baseHeaders, Accept: "application/xml" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (requests.ok) {
			const xml = await requests.text();
			const blocks = [...xml.matchAll(/<Invite\b[^>]*>[\s\S]*?<\/Invite>|<Invite\b[^>]*\/>/gi)].map((match) => match[0]);
			const matchedBlocks = blocks.filter((block) => {
				const id = xmlAttribute(block, "id");
				const email = xmlAttribute(block, "email")?.toLowerCase() ?? null;
				const username = xmlAttribute(block, "username")?.toLowerCase() ?? null;
				return Boolean(block.includes(machineIdentifier) || (owner?.id && id === owner.id) || (owner?.email && email === owner.email) || (owner?.username && username === owner.username) || (sharedServerId && id === sharedServerId));
			});
			const targets = matchedBlocks.length > 0 ? matchedBlocks : blocks.length === 1 ? blocks : [];

			for (const target of targets) {
				const id = xmlAttribute(target, "id");
				if (!id) continue;
				const friend = xmlAttribute(target, "friend") ?? "1";
				const home = xmlAttribute(target, "home") ?? "0";
				const server = xmlAttribute(target, "server") ?? "1";
				const accepted = await fetch(`https://plex.tv/api/invites/requests/${encodeURIComponent(id)}?friend=${encodeURIComponent(friend)}&home=${encodeURIComponent(home)}&server=${encodeURIComponent(server)}`, {
					method: "PUT",
					headers: { ...baseHeaders, Accept: "application/xml" },
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
				if (accepted.ok) {
					acceptedAny = true;
				} else {
					logger().warn(`Plex invite accept PUT /api/invites/requests/${id} returned status ${accepted.status}.`);
				}
			}
		} else {
			logger().warn(`Plex GET /api/invites/requests returned status ${requests.status}.`);
		}
	} catch (error) {
		logger().warn("Could not query plex.tv/api/invites/requests while auto-accepting Plex invite.", error);
	}

	if (acceptedAny) return true;

	// 2. Fallback: Plex v2 pending received shared server invites API.
	const jsonHeaders = { ...baseHeaders, Accept: "application/json" };
	try {
		const pending = await fetch("https://clients.plex.tv/api/v2/shared_servers/invites/received/pending", {
			headers: jsonHeaders,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (pending.ok) {
			const data: unknown = await pending.json().catch(() => null);
			const items = Array.isArray(data) ? data : [];
			const match =
				items.find((entry) => {
					if (!isRecord(entry)) return false;
					if (sharedServerId && (String(entry.id ?? "") === sharedServerId || String(entry.sharedServerId ?? "") === sharedServerId)) return true;
					return entry.machineIdentifier === machineIdentifier;
				}) ?? (items.length === 1 ? items[0] : undefined);
			const inviteId = match && isRecord(match) && (typeof match.id === "number" || typeof match.id === "string") ? String(match.id) : null;
			if (inviteId) {
				for (const method of ["PUT", "POST"] as const) {
					const accepted = await fetch(`https://clients.plex.tv/api/v2/shared_servers/invites/received/${encodeURIComponent(inviteId)}/accept`, {
						method,
						headers: jsonHeaders,
						signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
					});
					if (accepted.ok) return true;
				}
			}
		}
	} catch {
		return false;
	}
	return false;
}

/**
 * Waits for the newly accepted share to appear in the invited user's plex.tv resources (falling
 * back to the owner's v2/server/access_tokens list) and warms their per-server access token against
 * the Plex server URL so PMS registers the user in /accounts immediately.
 */
async function warmPlexUserAccess(baseUrl: string, machineIdentifier: string, ownerToken: string, invitedEmail: string, userToken: string): Promise<boolean> {
	const resourceHeaders = { "X-Plex-Token": userToken, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, "X-Plex-Product": "Flixer", Accept: "application/json" };
	let serverAccessToken: string | null = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		if (attempt > 0) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		try {
			const res = await fetch("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1", {
				headers: resourceHeaders,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!res.ok) continue;
			const resources: unknown = await res.json().catch(() => null);
			if (!Array.isArray(resources)) continue;
			const match = resources.find((entry) => isRecord(entry) && entry.clientIdentifier === machineIdentifier && typeof entry.accessToken === "string" && entry.accessToken.length > 0);
			if (match && isRecord(match) && typeof match.accessToken === "string") {
				if (match.accessToken === "SERVER_NOT_SUPPORTED") {
					logger().warn(`plex.tv returned accessToken "SERVER_NOT_SUPPORTED" for Plex server ${normalizeUrl(baseUrl)} — update Plex Media Server to a supported version so invited users can access it.`);
					break;
				}
				serverAccessToken = match.accessToken;
				break;
			}
		} catch {
			// Best-effort retry.
		}
	}

	if (!serverAccessToken) {
		try {
			const userIdentity = await plexUserIdentity(userToken);
			const res = await fetch(`https://plex.tv/api/v2/server/access_tokens?X-Plex-Client-Identifier=${encodeURIComponent(machineIdentifier)}`, {
				headers: { "X-Plex-Token": ownerToken, "X-Plex-Client-Identifier": machineIdentifier, Accept: "application/json" },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (res.ok) {
				const list: unknown = await res.json().catch(() => null);
				if (Array.isArray(list)) {
					const match = list.find((entry) => {
						if (!isRecord(entry) || entry.owned !== false || typeof entry.token !== "string" || !entry.token || entry.token === "SERVER_NOT_SUPPORTED") return false;
						const invited = isRecord(entry.invited) ? entry.invited : null;
						if (!invited) return false;
						if (userIdentity?.id && String(invited.id ?? "") === userIdentity.id) return true;
						if (userIdentity?.username && typeof invited.username === "string" && invited.username.toLowerCase() === userIdentity.username) return true;
						return typeof invited.email === "string" && invited.email.toLowerCase() === invitedEmail.toLowerCase();
					});
					if (match && isRecord(match) && typeof match.token === "string") {
						serverAccessToken = match.token;
					}
				}
			}
		} catch {
			// Best-effort fallback.
		}
	}
	if (!serverAccessToken) return false;

	const targetUrl = `${normalizeUrl(baseUrl)}/library/sections`;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		if (attempt > 0) {
			await new Promise((resolve) => setTimeout(resolve, 700));
		}
		try {
			const check = await fetch(targetUrl, {
				headers: { "X-Plex-Token": serverAccessToken, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, "X-Plex-Product": "Flixer", Accept: "application/json" },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (check.ok) return true;
			if (check.status !== 401 && check.status !== 403) return false;
			if (attempt === 2) {
				logger().warn(`Plex server ${normalizeUrl(baseUrl)} returned status ${check.status} when verifying newly invited user access.`);
			}
		} catch {
			return false;
		}
	}
	return false;
}

/** Attempts to accept a pending Plex server/home invite on behalf of the invited user, retrying briefly for Plex propagation. */
async function acceptPlexServerInvite(machineIdentifier: string, sharedServerId: string | null, owner: PlexOwnerIdentity | null, userToken: string): Promise<boolean> {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		if (attempt > 0) {
			await new Promise((resolve) => setTimeout(resolve, 600));
		}
		if (await tryAcceptPlexInviteOnce(machineIdentifier, sharedServerId, owner, userToken)) {
			return true;
		}
	}
	logger().warn(`Could not auto-accept Plex share invite for machine ${machineIdentifier}; user can still accept via Plex email.`);
	return false;
}

function readPlexErrorMessage(body: unknown): string | null {
	if (!isRecord(body)) return null;
	if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
	if (Array.isArray(body.errors)) {
		const first = body.errors.find((item) => isRecord(item) && typeof item.message === "string" && item.message.trim());
		if (first && isRecord(first) && typeof first.message === "string") return first.message.trim();
	}
	return null;
}

/** Asks plex.tv to share the server with the given address; auto-accepts and pins libraries when the user signed in via Plex OAuth. */
async function invitePlexUser(baseUrl: string, token: string, account: ExternalAccountRequest): Promise<ExternalAccountResult> {
	const [machineIdentifier, owner] = await Promise.all([plexMachineIdentifier(baseUrl, token), account.plexUserToken ? plexUserIdentity(token) : Promise.resolve(null)]);
	const needsServerInfo = account.libraryIds.some((value) => value.trim().length > 0) || Boolean(account.plexUserToken);
	const serverInfo = needsServerInfo ? await fetchPlexServerInfo(machineIdentifier, token) : { friendlyName: "Plex", sections: [] };
	const librarySectionIds = resolvePlexLibrarySectionIds(serverInfo.sections, account.libraryIds);
	const sharePayload = {
		machineIdentifier,
		invitedEmail: account.email,
		librarySectionIds,
		settings: { allowSync: account.allowDownloads ? "1" : "0" },
	};

	let response: Response;
	try {
		response = await fetch("https://plex.tv/api/v2/shared_servers", {
			method: "POST",
			headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(sharePayload),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new MediaServerError("The Plex invite could not be sent: plex.tv could not be reached.");
	}

	let sharedId: string | null = null;
	let alreadyAccepted = false;

	if (response.status === 422) {
		const errorBody: unknown = await response.json().catch(() => null);
		const { shares } = await listPlexShares(baseUrl, token).catch(() => ({ machineIdentifier, shares: [] as ExternalAccountSummary[] }));
		const existing = shares.find((share) => share.email?.toLowerCase() === account.email.toLowerCase());
		if (!existing) {
			const detail = readPlexErrorMessage(errorBody);
			throw new MediaServerError(detail ? `The Plex invite could not be sent: ${detail}` : "The Plex invite could not be sent: the server answered with status 422.");
		}
		sharedId = existing.id;
		// Update library/download settings on the existing share (best-effort).
		await fetch(`https://plex.tv/api/v2/shared_servers/${encodeURIComponent(existing.id)}`, {
			method: "PUT",
			headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ librarySectionIds, settings: sharePayload.settings }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		}).catch(() => undefined);
	} else if (response.status === 401 || response.status === 403) {
		throw new MediaServerError(`The Plex invite could not be sent: the server rejected the saved API key (status ${response.status}).`);
	} else if (!response.ok) {
		const errorBody: unknown = await response.json().catch(() => null);
		const detail = readPlexErrorMessage(errorBody);
		throw new MediaServerError(detail ? `The Plex invite could not be sent: ${detail}` : `The Plex invite could not be sent: the server answered with status ${response.status}.`);
	} else {
		const body: unknown = await response.json().catch(() => null);
		sharedId = isRecord(body) && (typeof body.id === "number" || typeof body.id === "string") ? String(body.id) : null;
		alreadyAccepted = isRecord(body) && Boolean(body.acceptedAt);
	}

	// Always attempt to accept pending friend/server/home invites when we have the user's Plex OAuth token.
	const acceptedViaToken = account.plexUserToken ? await acceptPlexServerInvite(machineIdentifier, sharedId, owner, account.plexUserToken) : false;
	const inviteAccepted = acceptedViaToken || alreadyAccepted;
	if (account.plexUserToken) {
		await pinPlexLibrariesForUser(account.plexUserToken, machineIdentifier, serverInfo, librarySectionIds, Boolean(account.disableOnlineMediaSources));
		if (account.disableOnlineMediaSources) {
			await disablePlexOnlineMediaSources(account.plexUserToken);
		}
		if (inviteAccepted) {
			await warmPlexUserAccess(baseUrl, machineIdentifier, token, account.email, account.plexUserToken);
		}
	}
	return { externalUserId: sharedId, invitedEmail: account.email, inviteAccepted };
}

/** Revokes a Plex server share or pending invite by shared_server id or invited email; treats 404 as already removed. */
async function deletePlexUser(baseUrl: string, token: string, account: ExternalAccountIdentity): Promise<void> {
	if (account.externalUserId) {
		let response: Response;
		try {
			response = await fetch(`https://plex.tv/api/v2/shared_servers/${encodeURIComponent(account.externalUserId)}`, {
				method: "DELETE",
				headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": PLEX_CLIENT_ID, Accept: "application/json" },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new MediaServerError("Could not revoke the Plex share: plex.tv could not be reached.");
		}
		if (response.ok || response.status === 404) {
			return;
		}
	}

	const { machineIdentifier, shares } = await listPlexShares(baseUrl, token);
	const email = account.externalEmail?.toLowerCase();
	const match = shares.find((share) => (account.externalUserId && share.id === account.externalUserId) || (email && share.email?.toLowerCase() === email));
	if (!match) {
		return;
	}
	let response: Response;
	try {
		response = await fetch(`https://plex.tv/api/servers/${encodeURIComponent(machineIdentifier)}/shared_servers/${encodeURIComponent(match.id)}`, {
			method: "DELETE",
			headers: { "X-Plex-Token": token, "X-Plex-Client-Identifier": PLEX_CLIENT_ID },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new MediaServerError("Could not revoke the Plex share: plex.tv could not be reached.");
	}
	if (response.status === 404) {
		return;
	}
	if (!response.ok) {
		throw new MediaServerError(`Could not revoke the Plex share: Plex answered with status ${response.status}.`);
	}
}

// ---- Shared entry points ---------------------------------------------------------------------------------------

/** Creates (or invites) an account on the media server. "other" servers have no API, so there is nothing to do. */
export function provisionExternalAccount(type: InviteServerType, url: string, apiKey: string | null, account: ExternalAccountRequest): Promise<ExternalAccountResult> {
	switch (type) {
		case "jellyfin":
		case "emby":
			if (!apiKey) return Promise.reject(new MediaServerError("The media server has no API key saved."));
			return createJellyfinUser(url, apiKey, account);
		case "plex":
			if (!apiKey) return Promise.reject(new MediaServerError("The Plex server has no token saved."));
			return invitePlexUser(url, apiKey, account);
		case "other":
			return Promise.resolve({ externalUserId: null, invitedEmail: null });
	}
}

/** Enables or disables an existing account on Jellyfin or Emby. No-op for Plex and "other". */
export async function setExternalAccountDisabled(type: InviteServerType, url: string, apiKey: string | null, externalUserId: string, disabled: boolean): Promise<void> {
	switch (type) {
		case "jellyfin":
		case "emby":
			if (!apiKey) throw new MediaServerError("The media server has no API key saved.");
			await setJellyfinUserDisabled(url, apiKey, externalUserId, disabled);
			return;
		case "plex":
		case "other":
			return;
	}
}

/** Deletes (or revokes) an account on the linked media server. "other" servers have no API. */
export async function deleteExternalAccount(type: InviteServerType, url: string, apiKey: string | null, account: ExternalAccountIdentity): Promise<void> {
	switch (type) {
		case "jellyfin":
		case "emby":
			if (!apiKey) throw new MediaServerError("The media server has no API key saved.");
			await deleteJellyfinUser(url, apiKey, account);
			return;
		case "plex":
			if (!apiKey) throw new MediaServerError("The Plex server has no token saved.");
			await deletePlexUser(url, apiKey, account);
			return;
		case "other":
			return;
	}
}

/** Lists existing accounts/shares on the media server for deletion sync. Returns null for "other" servers. */
export async function listExternalAccounts(type: InviteServerType, url: string, apiKey: string | null): Promise<ExternalAccountSummary[] | null> {
	switch (type) {
		case "jellyfin":
		case "emby":
			if (!apiKey) throw new MediaServerError("The media server has no API key saved.");
			return listJellyfinUsers(url, apiKey);
		case "plex": {
			if (!apiKey) throw new MediaServerError("The Plex server has no token saved.");
			const { shares } = await listPlexShares(url, apiKey);
			return shares;
		}
		case "other":
			return null;
	}
}

/** Verifies the saved URL and credentials actually reach the server. */
export async function testMediaServerConnection(type: InviteServerType, url: string, apiKey: string | null): Promise<void> {
	switch (type) {
		case "jellyfin":
		case "emby":
			if (!apiKey) throw new MediaServerError("An API key is required.");
			await testJellyfin(url, apiKey);
			return;
		case "plex":
			if (!apiKey) throw new MediaServerError("A Plex token is required.");
			await validatePlexServerVersion(url, apiKey);
			return;
		case "other":
			return;
	}
}
