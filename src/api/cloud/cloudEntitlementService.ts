import { randomUUID } from "node:crypto";
import { BadRequest, Forbidden, ServiceUnavailable } from "@tsed/exceptions";
import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { appConfig } from "../../config/store/appConfig.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import {
	createPkcePair,
	decryptCloudSecret,
	encryptCloudSecret,
	sealCloudOAuthState,
	unsealCloudOAuthState,
	verifyEntitlementsToken,
} from "./cloudSecrets.js";
import type { CloudAccount, CloudEntitlementStatus, CloudPlan, StoredCloudLinkState } from "./cloudTypes.js";

const CLOUD_LINK_SETTING = "cloud_link_state";
const CLOUD_INSTANCE_ID_SETTING = "cloud_instance_id";
const CLOUD_AUTO_SYNC_SETTING = "cloud_auto_sync_enabled";
const OAUTH_CLIENT_ID = "flixer-server";
const OFFLINE_GRACE_DAYS = 7;
const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	link_id?: string;
}

interface EntitlementsResponse {
	account?: CloudAccount;
	link?: { id?: string };
	plans?: CloudPlan[];
	syncedAt?: string;
	entitlementsToken?: string;
}

function normalizeCloudBaseUrl(raw: string): string {
	const cleaned = raw.replace(/\/+$/, "");
	if (process.env.NODE_ENV === "production") {
		const parsed = new URL(cleaned);
		const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
		if (parsed.protocol !== "https:" && !isLoopback) {
			throw new ServiceUnavailable("Flixer Cloud URL must use HTTPS in production.");
		}
	}
	return cleaned;
}

function validateRedirectUri(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new BadRequest("Invalid redirectUri.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new BadRequest("redirectUri must use http or https.");
	}
	if (url.username || url.password || url.hash) {
		throw new BadRequest("redirectUri must not contain credentials or a hash.");
	}
	return url.toString();
}

@Injectable()
export class CloudEntitlementService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	private getCloudWebUrl(): string {
		return normalizeCloudBaseUrl(appConfig().get("cloudWebUrl") || "https://flixer.dev");
	}

	private getCloudApiUrl(): string {
		return normalizeCloudBaseUrl(appConfig().get("cloudApiUrl") || "https://us-central1-flixermedia.cloudfunctions.net");
	}

	private async getSetting<T>(key: string): Promise<T | null> {
		const row = await this.dataSource.getRepository(Setting).findOneBy({ key });
		return (row?.value as T | null | undefined) ?? null;
	}

	private async setSetting(key: string, value: unknown): Promise<void> {
		const repo = this.dataSource.getRepository(Setting);
		const existing = await repo.findOneBy({ key });
		if (existing) {
			existing.value = value;
			existing.isPublic = false;
			await repo.save(existing);
			return;
		}
		const created = repo.create({ key, value, isPublic: false });
		await repo.save(created);
	}

	private async deleteSetting(key: string): Promise<void> {
		await this.dataSource.getRepository(Setting).delete({ key });
	}

	private async getOrCreateInstanceId(): Promise<string> {
		const existing = await this.getSetting<string>(CLOUD_INSTANCE_ID_SETTING);
		if (typeof existing === "string" && existing.trim()) {
			return existing.trim();
		}
		const created = randomUUID();
		await this.setSetting(CLOUD_INSTANCE_ID_SETTING, created);
		return created;
	}

	private async isAutoSyncEnabled(): Promise<boolean> {
		const stored = await this.getSetting<boolean>(CLOUD_AUTO_SYNC_SETTING);
		return stored !== false;
	}

	private toPublicStatus(stored: StoredCloudLinkState | null, autoSyncEnabled: boolean, instanceId: string | null): CloudEntitlementStatus {
		const cloudWebUrl = this.getCloudWebUrl();
		if (!stored) {
			return {
				connected: false,
				stale: false,
				autoSyncEnabled,
				gracePeriodDays: OFFLINE_GRACE_DAYS,
				instanceId,
				account: null,
				linkId: null,
				plans: [],
				features: [],
				syncedAt: null,
				lastSyncAttemptAt: null,
				lastError: null,
				cloudWebUrl,
			};
		}

		const syncedAtMs = stored.syncedAt ? Date.parse(stored.syncedAt) : Number.NaN;
		let stale = Number.isNaN(syncedAtMs) || Date.now() - syncedAtMs > OFFLINE_GRACE_MS;
		let plans: CloudPlan[] = [];
		let features: string[] = [];
		let account: CloudAccount | null = stored.account;
		let lastError = stored.lastError;

		if (stored.entitlementsTokenEncrypted) {
			try {
				const token = decryptCloudSecret(stored.entitlementsTokenEncrypted);
				const verified = verifyEntitlementsToken(token, { linkId: stored.linkId, instanceId });
				plans = verified.plans;
				account = verified.account;
				if (!stale) {
					if (Array.isArray(verified.features)) {
						features = verified.features;
					} else {
						const derived = new Set<string>();
						for (const plan of plans) {
							if (!plan.active) continue;
							if (Array.isArray(plan.features)) {
								for (const f of plan.features) derived.add(f);
							} else if (plan.id === "priority_support") {
								derived.add("priority_support");
							}
						}
						features = [...derived];
					}
				}
			} catch (error: unknown) {
				stale = true;
				plans = [];
				features = [];
				lastError = error instanceof Error ? error.message : "Stored Flixer Cloud entitlement signature is invalid.";
			}
		} else {
			stale = true;
		}

		return {
			connected: true,
			stale,
			autoSyncEnabled,
			gracePeriodDays: OFFLINE_GRACE_DAYS,
			instanceId,
			account,
			linkId: stored.linkId,
			plans,
			features,
			syncedAt: stored.syncedAt,
			lastSyncAttemptAt: stored.lastSyncAttemptAt,
			lastError,
			cloudWebUrl,
		};
	}

	async getStatus(): Promise<CloudEntitlementStatus> {
		const [stored, autoSyncEnabled, instanceId] = await Promise.all([
			this.getSetting<StoredCloudLinkState>(CLOUD_LINK_SETTING),
			this.isAutoSyncEnabled(),
			this.getSetting<string>(CLOUD_INSTANCE_ID_SETTING),
		]);
		return this.toPublicStatus(stored, autoSyncEnabled, instanceId);
	}

	async setAutoSyncEnabled(enabled: boolean): Promise<CloudEntitlementStatus> {
		await this.setSetting(CLOUD_AUTO_SYNC_SETTING, Boolean(enabled));
		return this.getStatus();
	}

	async hasActivePlan(planId: string): Promise<boolean> {
		const status = await this.getStatus();
		if (!status.connected || status.stale) {
			return false;
		}
		return status.plans.some((plan) => plan.id === planId && plan.active);
	}

	async getActivePlanIds(): Promise<string[]> {
		const status = await this.getStatus();
		if (!status.connected || status.stale) {
			return [];
		}
		return status.plans.filter((plan) => plan.active).map((plan) => plan.id);
	}

	async hasFeature(featureKey: string): Promise<boolean> {
		const status = await this.getStatus();
		if (!status.connected || status.stale) {
			return false;
		}
		return status.features.includes(featureKey);
	}

	async getActiveFeatures(): Promise<string[]> {
		const status = await this.getStatus();
		if (!status.connected || status.stale) {
			return [];
		}
		return status.features;
	}

	async requireFeature(featureKey: string): Promise<void> {
		if (!(await this.hasFeature(featureKey))) {
			throw new Forbidden(`An active flixer.dev membership granting "${featureKey}" is required.`);
		}
	}

	getCloudApiBaseUrl(): string {
		return this.getCloudApiUrl();
	}

	async getValidAccessToken(): Promise<string> {
		const stored = await this.getSetting<StoredCloudLinkState>(CLOUD_LINK_SETTING);
		if (!stored) {
			throw new Forbidden("This server is not connected to Flixer Cloud.");
		}
		let accessToken = decryptCloudSecret(stored.accessTokenEncrypted);
		const refreshToken = decryptCloudSecret(stored.refreshTokenEncrypted);

		if (Date.now() + TOKEN_REFRESH_BUFFER_MS >= stored.accessTokenExpiresAt) {
			const refreshed = await this.postTokenEndpoint({
				grant_type: "refresh_token",
				client_id: OAUTH_CLIENT_ID,
				refresh_token: refreshToken,
			});
			accessToken = refreshed.access_token;
			stored.accessTokenEncrypted = encryptCloudSecret(accessToken);
			stored.refreshTokenEncrypted = encryptCloudSecret(refreshed.refresh_token);
			stored.accessTokenExpiresAt = Date.now() + refreshed.expires_in * 1000;
			await this.setSetting(CLOUD_LINK_SETTING, stored);
		}
		return accessToken;
	}

	async startOAuthConnect(rawRedirectUri: string): Promise<{ authorizeUrl: string }> {
		const redirectUri = validateRedirectUri(rawRedirectUri);
		const { codeVerifier, codeChallenge } = createPkcePair();
		const state = sealCloudOAuthState(codeVerifier, redirectUri);

		const [serverName, instanceId] = await Promise.all([
			this.getSetting<string>("server_name"),
			this.getOrCreateInstanceId(),
		]);

		const authorizeUrl = new URL(`${this.getCloudWebUrl()}/oauth/authorize`);
		authorizeUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
		authorizeUrl.searchParams.set("redirect_uri", redirectUri);
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("state", state);
		authorizeUrl.searchParams.set("code_challenge", codeChallenge);
		authorizeUrl.searchParams.set("code_challenge_method", "S256");
		authorizeUrl.searchParams.set("server_name", typeof serverName === "string" && serverName.trim() ? serverName.trim() : "Flixer Server");
		authorizeUrl.searchParams.set("server_instance_id", instanceId);

		return { authorizeUrl: authorizeUrl.toString() };
	}

	private async postTokenEndpoint(body: Record<string, string>): Promise<TokenResponse> {
		const response = await fetch(`${this.getCloudApiUrl()}/serverOAuthToken`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
		if (!response.ok) {
			const message = data.error_description || data.error || `Flixer Cloud returned ${response.status}.`;
			const err = new Error(message) as Error & { oauthError?: string; status?: number };
			err.oauthError = data.error;
			err.status = response.status;
			throw err;
		}
		if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string" || typeof data.expires_in !== "number") {
			throw new Error("Flixer Cloud returned an incomplete token response.");
		}
		return data as TokenResponse;
	}

	private async fetchEntitlements(accessToken: string): Promise<EntitlementsResponse> {
		const response = await fetch(`${this.getCloudApiUrl()}/serverCloudEntitlements`, {
			method: "GET",
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		const data = (await response.json().catch(() => ({}))) as EntitlementsResponse & { error?: string; error_description?: string };
		if (!response.ok) {
			const message = data.error_description || data.error || `Flixer Cloud returned ${response.status}.`;
			const err = new Error(message) as Error & { oauthError?: string; status?: number };
			err.oauthError = data.error;
			err.status = response.status;
			throw err;
		}
		return data;
	}

	async completeOAuthCallback(code: string, state: string): Promise<CloudEntitlementStatus> {
		if (!code.trim() || !state.trim()) {
			throw new BadRequest("Missing authorization code or state.");
		}

		const sealed = unsealCloudOAuthState(state);
		if (!sealed) {
			throw new BadRequest("The Flixer Cloud authorization session is invalid or expired. Please try connecting again.");
		}

		let tokens: TokenResponse;
		try {
			tokens = await this.postTokenEndpoint({
				grant_type: "authorization_code",
				client_id: OAUTH_CLIENT_ID,
				code: code.trim(),
				redirect_uri: sealed.r,
				code_verifier: sealed.v,
			});
		} catch (error: unknown) {
			throw new BadRequest(error instanceof Error ? error.message : "Could not exchange Flixer Cloud authorization code.");
		}

		let entitlements: EntitlementsResponse;
		let verified;
		const instanceId = await this.getSetting<string>(CLOUD_INSTANCE_ID_SETTING);
		const linkId = tokens.link_id || "";
		try {
			entitlements = await this.fetchEntitlements(tokens.access_token);
			verified = verifyEntitlementsToken(entitlements.entitlementsToken ?? "", {
				linkId: linkId || entitlements.link?.id || undefined,
				instanceId,
			});
		} catch (error: unknown) {
			throw new ServiceUnavailable(error instanceof Error ? error.message : "Could not verify Flixer Cloud memberships.");
		}

		const nowIso = new Date().toISOString();
		const stored: StoredCloudLinkState = {
			linkId: verified.linkId || linkId || entitlements.link?.id || "",
			accessTokenEncrypted: encryptCloudSecret(tokens.access_token),
			refreshTokenEncrypted: encryptCloudSecret(tokens.refresh_token),
			accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
			entitlementsTokenEncrypted: encryptCloudSecret(entitlements.entitlementsToken!),
			account: verified.account,
			plans: verified.plans,
			syncedAt: verified.syncedAt || nowIso,
			lastSyncAttemptAt: nowIso,
			lastError: null,
		};

		await this.setSetting(CLOUD_LINK_SETTING, stored);
		return this.getStatus();
	}

	async syncEntitlements(options?: { scheduled?: boolean }): Promise<CloudEntitlementStatus> {
		if (options?.scheduled && !(await this.isAutoSyncEnabled())) {
			return this.getStatus();
		}
		const stored = await this.getSetting<StoredCloudLinkState>(CLOUD_LINK_SETTING);
		if (!stored) {
			return this.getStatus();
		}

		const attemptIso = new Date().toISOString();
		let accessToken: string;
		let refreshToken: string;
		try {
			accessToken = decryptCloudSecret(stored.accessTokenEncrypted);
			refreshToken = decryptCloudSecret(stored.refreshTokenEncrypted);
		} catch (error) {
			logger().warn("Could not decrypt stored Flixer Cloud credentials; clearing link.", error);
			await this.deleteSetting(CLOUD_LINK_SETTING);
			return this.getStatus();
		}

		try {
			if (Date.now() + TOKEN_REFRESH_BUFFER_MS >= stored.accessTokenExpiresAt) {
				const refreshed = await this.postTokenEndpoint({
					grant_type: "refresh_token",
					client_id: OAUTH_CLIENT_ID,
					refresh_token: refreshToken,
				});
				accessToken = refreshed.access_token;
				refreshToken = refreshed.refresh_token;
				stored.accessTokenEncrypted = encryptCloudSecret(accessToken);
				stored.refreshTokenEncrypted = encryptCloudSecret(refreshToken);
				stored.accessTokenExpiresAt = Date.now() + refreshed.expires_in * 1000;
			}

			const entitlements = await this.fetchEntitlements(accessToken);
			const instanceId = await this.getSetting<string>(CLOUD_INSTANCE_ID_SETTING);
			const verified = verifyEntitlementsToken(entitlements.entitlementsToken ?? "", {
				linkId: stored.linkId,
				instanceId,
			});
			const syncedIso = verified.syncedAt || new Date().toISOString();
			const updated: StoredCloudLinkState = {
				...stored,
				entitlementsTokenEncrypted: encryptCloudSecret(entitlements.entitlementsToken!),
				account: verified.account,
				plans: verified.plans,
				syncedAt: syncedIso,
				lastSyncAttemptAt: attemptIso,
				lastError: null,
			};
			await this.setSetting(CLOUD_LINK_SETTING, updated);
			return this.getStatus();
		} catch (error: unknown) {
			const typed = error as Error & { oauthError?: string; status?: number };
			if (typed.oauthError === "invalid_grant" || typed.oauthError === "invalid_token" || typed.status === 401 || typed.status === 403) {
				logger().warn("Flixer Cloud link was revoked or rejected; disconnecting.", { message: typed.message });
				await this.deleteSetting(CLOUD_LINK_SETTING);
				const status = await this.getStatus();
				return {
					...status,
					lastSyncAttemptAt: attemptIso,
					lastError: typed.message || "Flixer Cloud link was revoked.",
				};
			}

			const message = typed instanceof Error ? typed.message : "Could not reach Flixer Cloud.";
			logger().warn("Flixer Cloud sync failed; retaining cached entitlements.", { message });
			const updated: StoredCloudLinkState = {
				...stored,
				lastSyncAttemptAt: attemptIso,
				lastError: message,
			};
			await this.setSetting(CLOUD_LINK_SETTING, updated);
			return this.getStatus();
		}
	}

	async disconnect(): Promise<CloudEntitlementStatus> {
		const stored = await this.getSetting<StoredCloudLinkState>(CLOUD_LINK_SETTING);
		if (stored) {
			try {
				const refreshToken = decryptCloudSecret(stored.refreshTokenEncrypted);
				await fetch(`${this.getCloudApiUrl()}/serverOAuthToken`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						grant_type: "revoke",
						client_id: OAUTH_CLIENT_ID,
						token: refreshToken,
					}),
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				}).catch(() => undefined);
			} catch {
				// Ignore decryption/network errors during local disconnect
			}
			await this.deleteSetting(CLOUD_LINK_SETTING);
		}
		return this.getStatus();
	}
}
