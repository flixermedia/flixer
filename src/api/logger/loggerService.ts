import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Exception } from "@tsed/exceptions";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { appConfig } from "../../config/store/appConfig.js";
import type { ConfigName } from "../../config/store/configSchema.js";
import { loggerExporter } from "../../logs/loggerExporter.js";
import { AuthService } from "../auth/authService.js";
import type { LoggerCapacityPolicyRequest, LoggerConfigurationRequest, LoggerIngestionPolicyRequest, LoggerOwnerConfigurationRequest, LoggerOwnerPairingRequest, LoggerPairingRequest, LoggerQuotaRequest, LoggerRetentionRequest } from "./loggerRequests.js";

interface RetentionPolicy {
	enabled: boolean;
	days: number;
	severityDays?: Record<string, number>;
}

const producerKeys = {
	"flixer-ai": ["loggerAiIngestToken", "loggerAiIngestExpiry", "loggerAiIngestId"],
	"flixer-indexer": ["loggerIndexerIngestToken", "loggerIndexerIngestExpiry", "loggerIndexerIngestId"],
	"flixer-streamer": ["loggerStreamerIngestToken", "loggerStreamerIngestExpiry", "loggerStreamerIngestId"],
	"flixer-updater": ["loggerUpdaterIngestToken", "loggerUpdaterIngestExpiry", "loggerUpdaterIngestId"],
} as const satisfies Record<string, readonly [ConfigName, ConfigName, ConfigName]>;

export type LoggerProducer = keyof typeof producerKeys;
const producerCredentialKeys: ConfigName[] = Object.values(producerKeys).flat();
const localRenewalKeys: ConfigName[] = ["loggerLocalRenewalToken", "loggerLocalRenewalExpiry", "loggerLocalRenewalBinding"];
type ProducerConfiguration = { endpoint: string; token: string; expiresAt: string };

function validSeverityRetention(value: unknown): value is Record<string, number> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	for (const [level, days] of Object.entries(value)) {
		if (!["trace", "debug", "info", "warn", "error", "fatal"].includes(level) ||
			typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 3650) {
			return false;
		}
	}
	return true;
}

function loggerOrigin(input: string): string {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new BadRequest("The logger endpoint must be a valid HTTPS origin.");
	}
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const loopback = isIP(host) !== 0 && (host === "::1" || host.startsWith("127."));
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username || url.password || url.pathname !== "/" || url.search || url.hash
	) {
		throw new BadRequest("The logger endpoint must be an HTTPS origin (HTTP is allowed only on loopback).");
	}
	return url.origin;
}

function localOwnerToken(path: string): string {
	if (!isAbsolute(path)) throw new Error("Logger owner file path must be absolute.");
	const directory = lstatSync(dirname(path));
	if (!directory.isDirectory() || directory.uid !== process.geteuid?.() || (directory.mode & 0o077) !== 0) {
		throw new Error("Logger owner directory is not private.");
	}
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const file = fstatSync(fd);
		if (!file.isFile() || file.uid !== process.geteuid?.() || (file.mode & 0o077) !== 0 || file.size > 1024) {
			throw new Error("Logger owner file is not private.");
		}
		const buffer = Buffer.alloc(1025);
		let length = 0;
		while (length < buffer.length) {
			const read = readSync(fd, buffer, length, buffer.length - length, null);
			if (read === 0) break;
			length += read;
		}
		if (length > 1024) throw new Error("Logger owner file is too large.");
		const token = buffer.subarray(0, length).toString("utf8").trim();
		if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid logger owner credential.");
		return token;
	} finally {
		closeSync(fd);
	}
}

function localManagementCredential(payload: unknown, expiresAt: string): { token: string; expiry: string } {
	if (!payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(payload.token) || !("credential" in payload) || !payload.credential ||
		typeof payload.credential !== "object" || !("scope" in payload.credential) || payload.credential.scope !== "manage" ||
		!("expires_at" in payload.credential) || typeof payload.credential.expires_at !== "string" ||
		Date.parse(payload.credential.expires_at) !== Date.parse(expiresAt)) {
		throw new Exception(502, "The logger returned invalid bootstrap information.");
	}
	return { token: payload.token, expiry: payload.credential.expires_at };
}

function retentionPolicy(value: unknown): RetentionPolicy {
	if (!value || typeof value !== "object" || !("enabled" in value) || !("days" in value) ||
		typeof value.enabled !== "boolean" || typeof value.days !== "number" || !Number.isInteger(value.days) ||
		value.days < 0 || value.days > 3650 || (value.enabled && value.days === 0)) {
		throw new Exception(502, "The logger returned an invalid retention policy.");
	}
	const severityDays = "severity_days" in value ? value.severity_days : undefined;
	if (severityDays !== undefined && !validSeverityRetention(severityDays)) {
		throw new Exception(502, "The logger returned an invalid retention policy.");
	}
	return { enabled: value.enabled, days: value.days, ...(severityDays && Object.keys(severityDays).length ? { severityDays } : {}) };
}

function ingestionPolicy(value: unknown): LoggerIngestionPolicyRequest {
	if (!value || typeof value !== "object" || !("events_per_second" in value) ||
		typeof value.events_per_second !== "number" || !Number.isInteger(value.events_per_second) ||
		value.events_per_second < 1 || value.events_per_second > 100_000 || !("burst" in value) ||
		typeof value.burst !== "number" || !Number.isInteger(value.burst) || value.burst < 1_000 || value.burst > 1_000_000) {
		throw new Exception(502, "The logger returned an invalid ingestion policy.");
	}
	const optionalRate = (rate: unknown, burst: unknown) => {
		if (rate === undefined && burst === undefined) return undefined;
		if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 1 || rate > 100_000 ||
			typeof burst !== "number" || !Number.isInteger(burst) || burst < 1_000 || burst > 1_000_000) {
			throw new Exception(502, "The logger returned an invalid ingestion policy.");
		}
		return { rate, burst };
	};
	const credential = optionalRate("credential_events_per_second" in value ? value.credential_events_per_second : undefined,
		"credential_burst" in value ? value.credential_burst : undefined);
	const service = optionalRate("service_events_per_second" in value ? value.service_events_per_second : undefined,
		"service_burst" in value ? value.service_burst : undefined);
	return {
		eventsPerSecond: value.events_per_second,
		burst: value.burst,
		...(credential ? { credentialEventsPerSecond: credential.rate, credentialBurst: credential.burst } : {}),
		...(service ? { serviceEventsPerSecond: service.rate, serviceBurst: service.burst } : {}),
	};
}

function quotaPolicy(value: unknown): { maxBytes: number; usedBytes: number } {
	if (!value || typeof value !== "object" || !("max_bytes" in value) || !("used_bytes" in value) ||
		typeof value.max_bytes !== "number" || !Number.isSafeInteger(value.max_bytes) || value.max_bytes < 0 || value.max_bytes > 2 ** 50 ||
		typeof value.used_bytes !== "number" || !Number.isSafeInteger(value.used_bytes) || value.used_bytes < 0) {
		throw new Exception(502, "The logger returned an invalid quota.");
	}
	return { maxBytes: value.max_bytes, usedBytes: value.used_bytes };
}

function nonnegativeNumber(value: unknown, maximum: number): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function capacityPolicy(value: unknown): LoggerCapacityPolicyRequest {
	if (!value || typeof value !== "object" || !("max_database_bytes" in value) ||
		!("min_free_bytes" in value) || !nonnegativeNumber(value.max_database_bytes, 2 ** 50) ||
		!nonnegativeNumber(value.min_free_bytes, 2 ** 50)) {
		throw new Exception(502, "The logger returned an invalid capacity policy.");
	}
	return { maxDatabaseBytes: value.max_database_bytes, minFreeBytes: value.min_free_bytes };
}

function capacity(value: unknown) {
	if (!value || typeof value !== "object") throw new Exception(502, "The logger returned invalid capacity.");
	const numbers = ["filesystem_total_bytes", "filesystem_available_bytes", "database_bytes", "compaction_debt_bytes", "compactions_in_progress"] as const;
	const result = {} as Record<(typeof numbers)[number], number>;
	for (const key of numbers) {
		if (!(key in value) || !nonnegativeNumber(value[key], Number.MAX_SAFE_INTEGER)) {
			throw new Exception(502, "The logger returned invalid capacity.");
		}
		result[key] = value[key];
	}
	if (result.filesystem_available_bytes > result.filesystem_total_bytes) throw new Exception(502, "The logger returned invalid capacity.");
	return result;
}

function validPairingDeployment(deploymentId: unknown): deploymentId is string {
	return typeof deploymentId === "string" && deploymentId.length > 0 && deploymentId.trim() === deploymentId &&
		Buffer.byteLength(deploymentId) <= 128 && !/[\u0000-\u001f\u007f]/.test(deploymentId);
}

function pairingMetadata(value: unknown) {
	if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !/^[0-9a-f]{32}$/.test(value.id) ||
		!("expires_at" in value) || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at)) ||
		!("management_expiry" in value) || typeof value.management_expiry !== "string" || !Number.isFinite(Date.parse(value.management_expiry)) ||
		Date.parse(value.management_expiry) <= Date.parse(value.expires_at)) {
		throw new Exception(502, "The logger returned invalid pairing information.");
	}
	return { id: value.id, expiresAt: value.expires_at, managementExpiry: value.management_expiry };
}

/** Flixer control-plane operations; log data remains in flixer-logger. */
@Injectable()
export class LoggerService {
	private pairingInProgress = false;
	private producerRequests = new Map<LoggerProducer, Promise<ProducerConfiguration>>();
	private producerRevocationGeneration = 0;

	constructor(@Inject(AuthService) private readonly auth: Pick<AuthService, "requireAdmin">) {}

	async configuration(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const endpoint = store.get("loggerUrl");
		const expiry = store.get("loggerManageExpiry");
		return { configured: Boolean(endpoint && store.get("loggerManageToken")), endpoint: endpoint ?? null,
			...(expiry && Number.isFinite(Date.parse(expiry)) ? { managementExpiresAt: expiry } : {}) };
	}

	async configure(request: LoggerConfigurationRequest, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (this.pairingInProgress) throw new Exception(409, "Logger pairing is in progress.");
		const endpoint = loggerOrigin(request.endpoint);
		if (typeof request.manageToken !== "string" || request.manageToken.length < 32 || request.manageToken.length > 1024 ||
			/[\r\n]/.test(request.manageToken)) {
			throw new BadRequest("The logger management credential is invalid.");
		}
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const previousEndpoint = store.get("loggerUrl");
		const previousToken = store.get("loggerManageToken");
		const previousPendingUrl = store.get("loggerPendingPairingUrl");
		const previousPendingToken = store.get("loggerPendingPairingToken");
		const previousPendingExpiry = store.get("loggerPendingPairingExpiry");
		retentionPolicy(await this.request(endpoint, request.manageToken, "GET", "/api/logger/retention"));
		const ingest = await this.issueCredential(endpoint, request.manageToken, "ingest", 364 * 86_400_000);
		if (this.pairingInProgress || store.get("loggerUrl") !== previousEndpoint || store.get("loggerManageToken") !== previousToken ||
			store.get("loggerPendingPairingUrl") !== previousPendingUrl || store.get("loggerPendingPairingToken") !== previousPendingToken ||
			store.get("loggerPendingPairingExpiry") !== previousPendingExpiry) {
			throw new Exception(409, "Logger configuration changed; retry registration.");
		}
		store.setMany({
			loggerUrl: endpoint,
			loggerManageToken: request.manageToken,
			loggerManageExpiry: "",
			loggerIngestToken: ingest.token,
			loggerIngestExpiry: ingest.expiresAt,
			loggerIngestApp: "flixer",
			...(ingest.id ? { loggerIngestId: ingest.id } : {}),
		}, ["loggerOwnerUrl", "loggerOwnerToken", "loggerPendingPairingUrl", "loggerPendingPairingToken", "loggerPendingPairingExpiry", "loggerLocalPending", "loggerLocalManaged", ...localRenewalKeys, ...producerCredentialKeys, ...(ingest.id ? [] : ["loggerIngestId" as const])]);
		loggerExporter.configure({ endpoint, ...ingest });
		return { configured: true, endpoint };
	}

	async pairingStatus(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const endpoint = store.get("loggerPendingPairingUrl");
		return { pending: Boolean(endpoint && store.get("loggerPendingPairingToken")), endpoint: endpoint || null };
	}

	async pair(request: LoggerPairingRequest, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const endpoint = loggerOrigin(request.endpoint);
		if (!validPairingDeployment(request.deploymentId) ||
			typeof request.pairingToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(request.pairingToken)) {
			throw new BadRequest("Invalid logger pairing request.");
		}
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		if (this.pairingInProgress || store.get("loggerPendingPairingUrl")) {
			throw new Exception(409, "A logger pairing is already pending.");
		}
		this.pairingInProgress = true;
		try {
			const payload = await this.request(endpoint, undefined, "POST", "/api/logger/pairings/redeem", { token: request.pairingToken });
			if (!payload || typeof payload !== "object" || !("deployment_id" in payload) || payload.deployment_id !== request.deploymentId ||
				!("token" in payload) || typeof payload.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.token) ||
				!("credential" in payload) || !payload.credential || typeof payload.credential !== "object" ||
				!("scope" in payload.credential) || payload.credential.scope !== "manage" ||
				!("expires_at" in payload.credential) || typeof payload.credential.expires_at !== "string" ||
				!Number.isFinite(Date.parse(payload.credential.expires_at)) || Date.parse(payload.credential.expires_at) <= Date.now()) {
				throw new Exception(502, "The logger returned invalid pairing information.");
			}
			store.setMany({ loggerPendingPairingUrl: endpoint, loggerPendingPairingToken: payload.token, loggerPendingPairingExpiry: payload.credential.expires_at });
			return await this.finishPairing(endpoint, payload.token, payload.credential.expires_at);
		} finally {
			this.pairingInProgress = false;
		}
	}

	async retryPairing(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const endpoint = store.get("loggerPendingPairingUrl");
		const token = store.get("loggerPendingPairingToken");
		const expiry = store.get("loggerPendingPairingExpiry");
		if (!endpoint || !token || !expiry || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now()) {
			throw new Exception(409, "There is no valid pending logger pairing.");
		}
		if (this.pairingInProgress) throw new Exception(409, "Logger pairing is in progress.");
		this.pairingInProgress = true;
		try {
			return await this.finishPairing(loggerOrigin(endpoint), token, expiry);
		} finally {
			this.pairingInProgress = false;
		}
	}

	async discardPairing(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		if (this.pairingInProgress) throw new Exception(409, "Logger pairing is in progress.");
		if (!store.get("loggerPendingPairingUrl")) throw new Exception(409, "There is no pending logger pairing.");
		store.setMany({}, ["loggerPendingPairingUrl", "loggerPendingPairingToken", "loggerPendingPairingExpiry", "loggerLocalPending"]);
		return { discarded: true };
	}

	private async finishPairing(endpoint: string, token: string, expiry: string) {
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const previousEndpoint = store.get("loggerUrl");
		const previousToken = store.get("loggerManageToken");
		const locallyManaged = store.get("loggerLocalPending") === "true";
		retentionPolicy(await this.request(endpoint, token, "GET", "/api/logger/retention"));
		const ingest = await this.issueCredential(endpoint, token, "ingest", 364 * 86_400_000);
		if (store.get("loggerPendingPairingUrl") !== endpoint || store.get("loggerPendingPairingToken") !== token ||
			store.get("loggerPendingPairingExpiry") !== expiry ||
			store.get("loggerUrl") !== previousEndpoint || store.get("loggerManageToken") !== previousToken ||
			(store.get("loggerLocalPending") === "true") !== locallyManaged) {
			throw new Exception(409, "Logger configuration changed; retry pairing.");
		}
		store.setMany({
			loggerUrl: endpoint, loggerManageToken: token, loggerManageExpiry: expiry, loggerIngestToken: ingest.token, loggerIngestExpiry: ingest.expiresAt,
			loggerIngestApp: "flixer",
			...(locallyManaged ? { loggerLocalManaged: "true" } : {}),
			...(ingest.id ? { loggerIngestId: ingest.id } : {}),
		}, ["loggerOwnerUrl", "loggerOwnerToken", "loggerPendingPairingUrl", "loggerPendingPairingToken", "loggerPendingPairingExpiry", "loggerLocalPending", ...localRenewalKeys, ...(!locallyManaged ? ["loggerLocalManaged" as const] : []), ...producerCredentialKeys, ...(ingest.id ? [] : ["loggerIngestId" as const])]);
		loggerExporter.configure({ endpoint, ...ingest });
		return { configured: true, endpoint, managementExpiresAt: expiry };
	}

	/** Opt-in local development bootstrap and renewal; never replaces a manually configured connection. */
	async bootstrapLocal(ownerPath: string, endpoint: string, stopped: () => boolean = () => false): Promise<boolean> {
		const url = new URL(loggerOrigin(endpoint));
		if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) {
			throw new Error("Local logger bootstrap requires HTTPS or IPv4 loopback.");
		}
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		if (store.get("loggerUrl") || store.get("loggerManageToken")) {
			if (store.get("loggerLocalManaged") === "true" && store.get("loggerUrl") === url.origin) {
				await this.renewLocalManagement(ownerPath, url.origin, stopped);
			}
			return true;
		}
		if (this.pairingInProgress) return false;
		this.pairingInProgress = true;
		try {
			const pending = store.get("loggerPendingPairingUrl");
			const pendingToken = store.get("loggerPendingPairingToken");
			const pendingExpiry = store.get("loggerPendingPairingExpiry");
			if (pending) {
				if (store.get("loggerLocalPending") !== "true" || pending !== url.origin) return true;
				if (!pendingToken || !/^[A-Za-z0-9_-]{43}$/.test(pendingToken) || !pendingExpiry ||
					!Number.isFinite(Date.parse(pendingExpiry)) || !validPairingDeployment(store.get("loggerLocalDeploymentId"))) {
					throw new Error("Local logger bootstrap credential is invalid; manual recovery is required.");
				}
				if (Date.parse(pendingExpiry) > Date.now()) {
					if (stopped()) return false;
					await this.finishPairing(pending, pendingToken, pendingExpiry);
					return true;
				}
			}
			const owner = localOwnerToken(ownerPath);
			let deploymentId = store.get("loggerLocalDeploymentId");
			if (!deploymentId) {
				deploymentId = `coder-${randomUUID()}`;
				store.setMany({ loggerLocalDeploymentId: deploymentId });
			}
			if (!validPairingDeployment(deploymentId)) throw new Error("Invalid local logger deployment ID.");
			const expiresAt = new Date(Date.now() + 364 * 86_400_000).toISOString();
			const credential = localManagementCredential(await this.request(url.origin, owner, "POST", "/api/owner/credentials", {
				deployment_id: deploymentId, expires_at: expiresAt,
			}), expiresAt);
			if (stopped()) return false;
			if (store.get("loggerUrl") || store.get("loggerManageToken") ||
				store.get("loggerLocalDeploymentId") !== deploymentId ||
				store.get("loggerPendingPairingUrl") !== pending ||
				store.get("loggerPendingPairingToken") !== pendingToken ||
				store.get("loggerPendingPairingExpiry") !== pendingExpiry ||
				(pending && store.get("loggerLocalPending") !== "true")) {
				throw new Exception(409, "Logger configuration changed during local bootstrap.");
			}
			store.setMany({ loggerPendingPairingUrl: url.origin, loggerPendingPairingToken: credential.token,
				loggerPendingPairingExpiry: credential.expiry, loggerLocalPending: "true" });
			await this.finishPairing(url.origin, credential.token, credential.expiry);
			return true;
		} finally {
			this.pairingInProgress = false;
		}
	}

	private async renewLocalManagement(ownerPath: string, endpoint: string, stopped: () => boolean): Promise<void> {
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const token = store.get("loggerManageToken");
		const expiry = store.get("loggerManageExpiry");
		const deploymentId = store.get("loggerLocalDeploymentId");
		if (!token || !expiry || !Number.isFinite(Date.parse(expiry)) || !validPairingDeployment(deploymentId)) {
			throw new Error("Local logger management configuration is invalid.");
		}
		if (Date.parse(expiry) > Date.now() + 30 * 86_400_000 || this.pairingInProgress) return;
		this.pairingInProgress = true;
		try {
			const binding = createHash("sha256").update(JSON.stringify([endpoint, deploymentId, token, expiry])).digest("hex");
			const pendingToken = store.get("loggerLocalRenewalToken");
			const pendingExpiry = store.get("loggerLocalRenewalExpiry");
			const pendingBinding = store.get("loggerLocalRenewalBinding");
			const hasPending = Boolean(pendingToken || pendingExpiry || pendingBinding);
			if (hasPending && (!pendingToken || !/^[A-Za-z0-9_-]{43}$/.test(pendingToken) || !pendingExpiry ||
				!Number.isFinite(Date.parse(pendingExpiry)) || pendingBinding !== binding)) {
				throw new Error("Pending local logger renewal is invalid; manual recovery is required.");
			}
			let credential: { token: string; expiry: string };
			if (pendingToken && pendingExpiry && Date.parse(pendingExpiry) > Date.now()) {
				credential = { token: pendingToken, expiry: pendingExpiry };
			} else {
				const owner = localOwnerToken(ownerPath);
				const expiresAt = new Date(Date.now() + 364 * 86_400_000).toISOString();
				credential = localManagementCredential(await this.request(endpoint, owner, "POST", "/api/owner/credentials", {
					deployment_id: deploymentId, expires_at: expiresAt,
				}), expiresAt);
				if (stopped()) return;
				if (store.get("loggerUrl") !== endpoint || store.get("loggerManageToken") !== token ||
					store.get("loggerManageExpiry") !== expiry || store.get("loggerLocalManaged") !== "true" ||
					store.get("loggerLocalDeploymentId") !== deploymentId || store.get("loggerPendingPairingUrl") ||
					store.get("loggerLocalRenewalToken") !== pendingToken || store.get("loggerLocalRenewalExpiry") !== pendingExpiry ||
					store.get("loggerLocalRenewalBinding") !== pendingBinding) {
					throw new Exception(409, "Logger configuration changed during local renewal.");
				}
				store.setMany({ loggerLocalRenewalToken: credential.token, loggerLocalRenewalExpiry: credential.expiry, loggerLocalRenewalBinding: binding });
			}
			retentionPolicy(await this.request(endpoint, credential.token, "GET", "/api/logger/retention"));
			if (stopped()) return;
			if (store.get("loggerUrl") !== endpoint || store.get("loggerManageToken") !== token ||
				store.get("loggerManageExpiry") !== expiry || store.get("loggerLocalManaged") !== "true" ||
				store.get("loggerLocalDeploymentId") !== deploymentId || store.get("loggerPendingPairingUrl") ||
				store.get("loggerLocalRenewalToken") !== credential.token || store.get("loggerLocalRenewalExpiry") !== credential.expiry ||
				store.get("loggerLocalRenewalBinding") !== binding) {
				throw new Exception(409, "Logger configuration changed during local renewal.");
			}
			store.setMany({ loggerManageToken: credential.token, loggerManageExpiry: credential.expiry }, localRenewalKeys);
		} finally {
			this.pairingInProgress = false;
		}
	}

	async ownerConfiguration(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const endpoint = store.get("loggerUrl");
		return { configured: Boolean(endpoint && store.get("loggerOwnerUrl") === endpoint && store.get("loggerOwnerToken")) };
	}

	async configureOwner(request: LoggerOwnerConfigurationRequest, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (typeof request.ownerToken !== "string" || request.ownerToken.length < 32 || request.ownerToken.length > 1024 ||
			/[\r\n]/.test(request.ownerToken)) throw new BadRequest("The logger owner credential is invalid.");
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const { endpoint, token: manageToken } = this.credentials();
		capacity(await this.request(endpoint, request.ownerToken, "GET", "/api/owner/capacity"));
		if (store.get("loggerUrl") !== endpoint || store.get("loggerManageToken") !== manageToken) {
			throw new Exception(409, "Logger configuration changed; retry owner registration.");
		}
		store.setMany({ loggerOwnerUrl: endpoint, loggerOwnerToken: request.ownerToken });
		return { configured: true };
	}

	async ownerCapacity(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.ownerCredentials();
		return capacity(await this.request(endpoint, token, "GET", "/api/owner/capacity"));
	}

	async getCapacityPolicy(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.ownerCredentials();
		return capacityPolicy(await this.request(endpoint, token, "GET", "/api/owner/capacity-policy"));
	}

	async setCapacityPolicy(request: LoggerCapacityPolicyRequest, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!nonnegativeNumber(request.maxDatabaseBytes, 2 ** 50) || !nonnegativeNumber(request.minFreeBytes, 2 ** 50)) {
			throw new BadRequest("Capacity thresholds must be whole numbers between 0 and 1125899906842624 bytes.");
		}
		const { endpoint, token } = this.ownerCredentials();
		return capacityPolicy(await this.request(endpoint, token, "PUT", "/api/owner/capacity-policy", {
			max_database_bytes: request.maxDatabaseBytes, min_free_bytes: request.minFreeBytes,
		}));
	}

	async createOwnerPairing(request: LoggerOwnerPairingRequest, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!validPairingDeployment(request.deploymentId) || !Number.isInteger(request.minutes) || request.minutes < 1 || request.minutes > 15 ||
			!Number.isInteger(request.managementDays) || request.managementDays < 1 || request.managementDays > 364) {
			throw new BadRequest("Invalid logger pairing settings.");
		}
		const { endpoint, token } = this.ownerCredentials();
		const now = Date.now();
		const expiresAt = new Date(now + request.minutes * 60_000).toISOString();
		const managementExpiry = new Date(now + request.managementDays * 86_400_000).toISOString();
		const payload = await this.request(endpoint, token, "POST", "/api/owner/pairings", {
			deployment_id: request.deploymentId, expires_at: expiresAt, management_expiry: managementExpiry,
		});
		if (!payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string" ||
			!/^[A-Za-z0-9_-]{43}$/.test(payload.token) || !("pairing" in payload)) {
			throw new Exception(502, "The logger returned invalid pairing information.");
		}
		const pairing = pairingMetadata(payload.pairing);
		if (Date.parse(pairing.expiresAt) !== Date.parse(expiresAt) || Date.parse(pairing.managementExpiry) !== Date.parse(managementExpiry)) {
			throw new Exception(502, "The logger returned invalid pairing expiry.");
		}
		return { ...pairing, token: payload.token };
	}

	async listOwnerPairings(deploymentId: string, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!validPairingDeployment(deploymentId)) throw new BadRequest("Invalid deployment ID.");
		const { endpoint, token } = this.ownerCredentials();
		const query = new URLSearchParams({ deployment_id: deploymentId });
		const payload = await this.request(endpoint, token, "GET", `/api/owner/pairings?${query}`);
		if (!payload || typeof payload !== "object" || !("pairings" in payload) || !Array.isArray(payload.pairings) || payload.pairings.length > 100) {
			throw new Exception(502, "The logger returned invalid pairing information.");
		}
		return payload.pairings.map(pairingMetadata);
	}

	async revokeOwnerPairing(deploymentId: string, id: string, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!validPairingDeployment(deploymentId) || !/^[0-9a-f]{32}$/.test(id)) throw new BadRequest("Invalid pairing ID or deployment.");
		const { endpoint, token } = this.ownerCredentials();
		const query = new URLSearchParams({ deployment_id: deploymentId });
		await this.request(endpoint, token, "DELETE", `/api/owner/pairings/${id}?${query}`);
		return { revoked: true };
	}

	async listOwnerCredentials(deploymentId: string, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!validPairingDeployment(deploymentId)) throw new BadRequest("Invalid deployment ID.");
		const { endpoint, token } = this.ownerCredentials();
		const query = new URLSearchParams({ deployment_id: deploymentId });
		const payload = await this.request(endpoint, token, "GET", `/api/owner/credentials?${query}`);
		if (!payload || typeof payload !== "object" || !("credentials" in payload) ||
			!Array.isArray(payload.credentials) || payload.credentials.length > 100) {
			throw new Exception(502, "The logger returned invalid credentials.");
		}
		return payload.credentials.map((credential: unknown) => {
			if (!credential || typeof credential !== "object" || !("id" in credential) ||
				typeof credential.id !== "string" || !/^[0-9a-f]{32}$/.test(credential.id) ||
				!("scope" in credential) || credential.scope !== "manage" ||
				!("expires_at" in credential) || typeof credential.expires_at !== "string" ||
				!Number.isFinite(Date.parse(credential.expires_at))) {
				throw new Exception(502, "The logger returned invalid credentials.");
			}
			return { id: credential.id, expiresAt: credential.expires_at };
		});
	}

	async revokeOwnerCredential(deploymentId: string, id: string, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!validPairingDeployment(deploymentId) || !/^[0-9a-f]{32}$/.test(id)) throw new BadRequest("Invalid credential ID or deployment.");
		const { endpoint, token } = this.ownerCredentials();
		const query = new URLSearchParams({ deployment_id: deploymentId });
		await this.request(endpoint, token, "DELETE", `/api/owner/credentials/${id}?${query}`);
		return { revoked: true };
	}

	restoreExporter(): void {
		const store = appConfig().persistent;
		const endpoint = store?.get("loggerUrl");
		const token = store?.get("loggerIngestToken");
		const expiresAt = store?.get("loggerIngestExpiry");
		if (endpoint && token && expiresAt && Number.isFinite(Date.parse(expiresAt))) {
			loggerExporter.configure({ endpoint: loggerOrigin(endpoint), token, expiresAt });
		}
	}

	async renewIngestCredential(): Promise<void> {
		const store = appConfig().persistent;
		if (!store) return;
		const endpoint = store.get("loggerUrl");
		const token = store.get("loggerManageToken");
		if (!endpoint || !token) return;
		const expiry = Date.parse(store.get("loggerIngestExpiry") ?? "");
		if (store.get("loggerIngestToken") && store.get("loggerIngestApp") === "flixer" &&
			Number.isFinite(expiry) && expiry > Date.now() + 7 * 86_400_000) return;
		const previousToken = store.get("loggerIngestToken");
		const previousExpiry = store.get("loggerIngestExpiry");
		const previousId = store.get("loggerIngestId");
		const generation = this.producerRevocationGeneration;
		const ingest = await this.issueCredential(loggerOrigin(endpoint), token, "ingest", 364 * 86_400_000);
		if (store.get("loggerUrl") !== endpoint || store.get("loggerManageToken") !== token ||
			store.get("loggerIngestToken") !== previousToken || store.get("loggerIngestExpiry") !== previousExpiry ||
			store.get("loggerIngestId") !== previousId || generation !== this.producerRevocationGeneration) {
			throw new Error("Logger configuration changed while renewing the ingestion credential.");
		}
		store.setMany({ loggerIngestToken: ingest.token, loggerIngestExpiry: ingest.expiresAt, loggerIngestApp: "flixer",
			...(ingest.id ? { loggerIngestId: ingest.id } : {}) }, ingest.id ? [] : ["loggerIngestId"]);
		loggerExporter.renewCredential({ endpoint, ...ingest });
	}

	async getRetention(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.credentials();
		return retentionPolicy(await this.request(endpoint, token, "GET", "/api/logger/retention"));
	}

	async health(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.credentials();
		let payload: unknown;
		try {
			payload = await this.request(endpoint, token, "GET", "/api/health/ready");
		} catch (error) {
			if (!(error instanceof Exception)) throw error;
			return { status: "unavailable" as const, exporter: loggerExporter.status() };
		}
		if (!payload || typeof payload !== "object" || !("status" in payload) || payload.status !== "ready") {
			return { status: "unavailable" as const, exporter: loggerExporter.status() };
		}
		return { status: "ready" as const, exporter: loggerExporter.status() };
	}

	async status(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.credentials();
		const payload = await this.request(endpoint, token, "GET", "/api/status");
		if (!payload || typeof payload !== "object" || !("status" in payload) || payload.status !== "ready" ||
			!("last_ingested_at" in payload) ||
			(payload.last_ingested_at !== null && (typeof payload.last_ingested_at !== "string" || !Number.isFinite(Date.parse(payload.last_ingested_at))))) {
			throw new Exception(502, "The logger returned an invalid status.");
		}
		const count = (key: string): number => {
			if (!(key in payload) || typeof payload[key] !== "number" || !Number.isSafeInteger(payload[key]) || payload[key] < 0) {
				throw new Exception(502, "The logger returned an invalid status.");
			}
			return payload[key];
		};
		let retention: { completed_at: string; deleted: number; batch_full: boolean; failed: boolean } | null = null;
		if ("retention" in payload && payload.retention !== null) {
			const value = payload.retention;
			if (!value || typeof value !== "object" || !("completed_at" in value) ||
				typeof value.completed_at !== "string" || !Number.isFinite(Date.parse(value.completed_at)) ||
				!("deleted" in value) || typeof value.deleted !== "number" || !Number.isSafeInteger(value.deleted) ||
				value.deleted < 0 || !("batch_full" in value) || typeof value.batch_full !== "boolean" ||
				!("failed" in value) || typeof value.failed !== "boolean") {
				throw new Exception(502, "The logger returned an invalid retention status.");
			}
			retention = { completed_at: value.completed_at, deleted: value.deleted, batch_full: value.batch_full, failed: value.failed };
		}
		return {
			status: "ready" as const,
			last_ingested_at: payload.last_ingested_at,
			live_subscribers: count("live_subscribers"),
			active_ingestions: count("active_ingestions"),
			active_queries: count("active_queries"),
			max_ingestions: count("max_ingestions"),
			max_queries: count("max_queries"),
			retention,
		};
	}

	async setRetention(request: LoggerRetentionRequest, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (typeof request.enabled !== "boolean" || !Number.isInteger(request.days) || request.days < 1 || request.days > 3650) {
			throw new BadRequest("Retention must specify a boolean enabled flag and between 1 and 3650 days.");
		}
		const severityDays = request.severityDays;
		if (severityDays !== undefined && !validSeverityRetention(severityDays)) {
			throw new BadRequest("Severity retention must contain known levels with between 1 and 3650 days.");
		}
		const { endpoint, token } = this.credentials();
		return retentionPolicy(await this.request(endpoint, token, "PUT", "/api/logger/retention", {
			enabled: request.enabled, days: request.days, ...(severityDays ? { severity_days: severityDays } : {}),
		}));
	}

	async getIngestionPolicy(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.credentials();
		return ingestionPolicy(await this.request(endpoint, token, "GET", "/api/logger/ingestion-policy"));
	}

	async setIngestionPolicy(request: LoggerIngestionPolicyRequest, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!Number.isInteger(request.eventsPerSecond) || request.eventsPerSecond < 1 || request.eventsPerSecond > 100_000 ||
			!Number.isInteger(request.burst) || request.burst < 1_000 || request.burst > 1_000_000) {
			throw new BadRequest("Invalid logger ingestion rate or burst.");
		}
		const { credentialEventsPerSecond, credentialBurst, serviceEventsPerSecond, serviceBurst } = request;
		const validOptionalRate = (rate: number | undefined, burst: number | undefined) =>
			(rate === undefined && burst === undefined) ||
			(typeof rate === "number" && Number.isInteger(rate) && rate >= 1 && rate <= 100_000 &&
				typeof burst === "number" && Number.isInteger(burst) && burst >= 1_000 && burst <= 1_000_000);
		if (!validOptionalRate(credentialEventsPerSecond, credentialBurst) || !validOptionalRate(serviceEventsPerSecond, serviceBurst)) {
			throw new BadRequest("Invalid logger credential or service ingestion rate or burst.");
		}
		const { endpoint, token } = this.credentials();
		return ingestionPolicy(await this.request(endpoint, token, "PUT", "/api/logger/ingestion-policy", {
			events_per_second: request.eventsPerSecond,
			burst: request.burst,
			...(credentialEventsPerSecond === undefined ? {} : {
				credential_events_per_second: credentialEventsPerSecond,
				credential_burst: credentialBurst,
			}),
			...(serviceEventsPerSecond === undefined ? {} : {
				service_events_per_second: serviceEventsPerSecond,
				service_burst: serviceBurst,
			}),
		}));
	}

	async getQuota(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.credentials();
		return quotaPolicy(await this.request(endpoint, token, "GET", "/api/logger/quota"));
	}

	async setQuota(request: LoggerQuotaRequest, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0 || request.maxBytes > 2 ** 50) {
			throw new BadRequest("The logger quota must be a whole number between 0 and 1125899906842624 bytes.");
		}
		const { endpoint, token } = this.credentials();
		return quotaPolicy(await this.request(endpoint, token, "PUT", "/api/logger/quota", { max_bytes: request.maxBytes }));
	}

	async issueQueryToken(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.credentials();
		return { endpoint, ...await this.issueCredential(endpoint, token, "query", 60_000) };
	}

	async listCredentials(authorization?: string) {
		await this.auth.requireAdmin(authorization);
		const { endpoint, token } = this.credentials();
		const payload = await this.request(endpoint, token, "GET", "/api/logger/credentials");
		if (!payload || typeof payload !== "object" || !("credentials" in payload) ||
			!Array.isArray(payload.credentials) || payload.credentials.length > 100) {
			throw new Exception(502, "The logger returned invalid credentials.");
		}
		return payload.credentials.map((credential: unknown) => {
			if (!credential || typeof credential !== "object" || !("id" in credential) ||
				typeof credential.id !== "string" || !/^[0-9a-f]{32}$/.test(credential.id) ||
				!("scope" in credential) || (credential.scope !== "ingest" && credential.scope !== "query") ||
				!("expires_at" in credential) || typeof credential.expires_at !== "string" ||
				!Number.isFinite(Date.parse(credential.expires_at))) {
				throw new Exception(502, "The logger returned invalid credentials.");
			}
			const app = "app" in credential ? credential.app : undefined;
			if (app !== undefined && (typeof app !== "string" || credential.scope !== "ingest" || !/^[a-z][a-z0-9-]{0,63}$/.test(app))) {
				throw new Exception(502, "The logger returned invalid credentials.");
			}
			return { id: credential.id, scope: credential.scope, expiresAt: credential.expires_at, ...(app ? { app } : {}) };
		});
	}

	async revokeCredential(id: string, authorization?: string) {
		await this.auth.requireAdmin(authorization);
		if (!/^[0-9a-f]{32}$/.test(id)) throw new BadRequest("Invalid logger credential ID.");
		const { endpoint, token } = this.credentials();
		await this.request(endpoint, token, "DELETE", `/api/logger/credentials/${id}`);
		this.producerRevocationGeneration++;
		const store = appConfig().persistent;
		if (store && store.get("loggerUrl") === endpoint && store.get("loggerManageToken") === token) {
			if (store.get("loggerIngestId") === id) {
				store.setMany({}, ["loggerIngestToken", "loggerIngestExpiry", "loggerIngestId", "loggerIngestApp"]);
				loggerExporter.configure();
			}
			for (const [tokenKey, expiryKey, idKey] of Object.values(producerKeys)) {
				if (store.get(idKey) === id) store.setMany({}, [tokenKey, expiryKey, idKey]);
			}
		}
		return { revoked: true };
	}

	/** Returns an application-bound ingestion credential, coalescing requests for the same producer. */
	producerIngestConfiguration(app: LoggerProducer): Promise<ProducerConfiguration> {
		let request = this.producerRequests.get(app);
		if (!request) {
			request = this.loadProducerIngestConfiguration(app);
			this.producerRequests.set(app, request);
			const pending = request;
			void request.then(() => {
				if (this.producerRequests.get(app) === pending) this.producerRequests.delete(app);
			}, () => {
				if (this.producerRequests.get(app) === pending) this.producerRequests.delete(app);
			});
		}
		return request;
	}

	private async loadProducerIngestConfiguration(app: LoggerProducer) {
		const store = appConfig().persistent;
		if (!store) throw new Exception(503, "The Flixer configuration store is unavailable.");
		const { endpoint, token: management } = this.credentials();
		const [tokenKey, expiryKey, idKey] = producerKeys[app];
		const existing = store.get(tokenKey);
		const expiry = store.get(expiryKey);
		const id = store.get(idKey);
		if (existing && expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now() + 7 * 86_400_000) {
			return { endpoint, token: existing, expiresAt: expiry };
		}
		const generation = this.producerRevocationGeneration;
		const issued = await this.issueCredential(endpoint, management, "ingest", 364 * 86_400_000, app);
		if (store.get("loggerUrl") !== endpoint || store.get("loggerManageToken") !== management ||
			store.get(tokenKey) !== existing || store.get(expiryKey) !== expiry || store.get(idKey) !== id ||
			generation !== this.producerRevocationGeneration) {
			throw new Exception(409, "Logger configuration changed during producer enrollment.");
		}
		store.setMany({ [tokenKey]: issued.token, [expiryKey]: issued.expiresAt, ...(issued.id ? { [idKey]: issued.id } : {}) },
			issued.id ? [] : [idKey]);
		return { endpoint, token: issued.token, expiresAt: issued.expiresAt };
	}

	private async issueCredential(endpoint: string, token: string, scope: "query" | "ingest", lifetime: number, app = "flixer") {
		const expiresAt = new Date(Date.now() + lifetime).toISOString();
		const payload = await this.request(endpoint, token, "POST", "/api/logger/credentials", {
			scope, expires_at: expiresAt, ...(scope === "ingest" ? { app } : {}),
		});
		if (!payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string" ||
			payload.token.length < 32 || payload.token.length > 1024 || !("credential" in payload) ||
			!payload.credential || typeof payload.credential !== "object" ||
			!("scope" in payload.credential) || payload.credential.scope !== scope ||
			!("expires_at" in payload.credential) || typeof payload.credential.expires_at !== "string" ||
			(scope === "ingest" && (!("app" in payload.credential) || payload.credential.app !== app))) {
			throw new Exception(502, "The logger returned an invalid credential.");
		}
		const actualExpiry = Date.parse(payload.credential.expires_at);
		if (!Number.isFinite(actualExpiry) || actualExpiry <= Date.now() || actualExpiry > Date.parse(expiresAt)) {
			throw new Exception(502, "The logger returned an invalid credential expiry.");
		}
		const id = "id" in payload.credential ? payload.credential.id : undefined;
		if (id !== undefined && (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id))) {
			throw new Exception(502, "The logger returned an invalid credential ID.");
		}
		return { token: payload.token, expiresAt: payload.credential.expires_at, ...(id ? { id } : {}) };
	}

	private credentials(): { endpoint: string; token: string } {
		const store = appConfig().persistent;
		const endpoint = store?.get("loggerUrl");
		const token = store?.get("loggerManageToken");
		if (!endpoint || !token) throw new Exception(503, "The logger is not configured.");
		return { endpoint: loggerOrigin(endpoint), token };
	}

	private ownerCredentials(): { endpoint: string; token: string } {
		const store = appConfig().persistent;
		const { endpoint } = this.credentials();
		const token = store?.get("loggerOwnerToken");
		if (!token || store?.get("loggerOwnerUrl") !== endpoint) throw new Exception(503, "The logger owner credential is not configured.");
		return { endpoint, token };
	}

	private async request(endpoint: string, token: string | undefined, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<unknown> {
		let response: Response;
		try {
			response = await fetch(endpoint + path, {
				method,
				headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
				body: body === undefined ? undefined : JSON.stringify(body),
				redirect: "error",
				signal: AbortSignal.timeout(8_000),
			});
		} catch {
			throw new Exception(503, "The logger could not be reached securely.");
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Exception(response.status === 401 ? 502 : response.status >= 500 ? 503 : 502, "The logger rejected the control request.");
		}
		if (method === "DELETE" && response.status === 204) return null;
		if (!response.body) throw new Exception(502, "The logger returned an empty response.");
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > 64 * 1024) throw new Exception(502, "The logger response is too large.");
				chunks.push(value);
			}
			return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
		} catch (error) {
			await reader.cancel();
			if (error instanceof Exception) throw error;
			throw new Exception(502, "The logger returned an invalid response.");
		} finally {
			reader.releaseLock();
		}
	}
}
