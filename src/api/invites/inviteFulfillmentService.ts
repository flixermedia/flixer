import { Inject, Injectable, logger } from "@tsed/di";
import { randomUUID } from "node:crypto";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Invitation } from "../../entities/invitation.entity.js";
import { InvitationUsage } from "../../entities/invitationUsage.entity.js";
import type { InviteServer, InviteServerType } from "../../entities/inviteServer.entity.js";
import { UserLinkedAccount, type LinkedAccountStatus } from "../../entities/userLinkedAccount.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { appConfig } from "../../config/store/appConfig.js";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.js";
import { mimeForAvatarFile, readAvatarFile } from "../auth/avatar/avatarStorage.js";
import { decryptSecret } from "./inviteSecrets.js";
import { buildInviteDestination, type InviteDestination } from "./inviteDestination.js";
import { deleteExternalAccount, grantExternalLibraryAccess, provisionExternalAccount, setExternalAccountDisabled, uploadExternalUserAvatar, type ExternalAccountResult } from "./mediaServerClient.js";

const CREDENTIALS_CONTEXT = "flixer:invites:pending-credentials:v1";
const CREDENTIALS_AAD = Buffer.from(CREDENTIALS_CONTEXT);

function credentialsKey(): Buffer {
	return deriveAesKey(appConfig().get("appSecret") ?? "", CREDENTIALS_CONTEXT, "APP_SECRET must be set to at least 32 bytes to hold invite credentials.");
}

export interface PendingInviteCredentials {
	password: string;
	email: string;
	plexUserToken?: string;
}

export interface LinkedServiceOutcome {
	serverId: string;
	name: string;
	type: InviteServerType;
	url: string | null;
	status: LinkedAccountStatus;
	alreadyLinked: boolean;
	invitedByEmail: boolean;
	error: string | null;
}

function invitationTargetServers(invitation: Invitation): InviteServer[] {
	const byId = new Map<string, InviteServer>();
	for (const target of invitation.targets ?? []) {
		if (target.server) {
			byId.set(target.server.id, target.server);
		}
	}
	if (invitation.serverId && invitation.server && !byId.has(invitation.server.id)) {
		byId.set(invitation.server.id, invitation.server);
	}
	return Array.from(byId.values());
}

export function encryptPendingCredentials(credentials: PendingInviteCredentials): string {
	return aesGcmEncrypt(JSON.stringify(credentials), credentialsKey(), CREDENTIALS_AAD);
}

export function decryptPendingCredentials(encrypted: string): PendingInviteCredentials {
	return JSON.parse(aesGcmDecrypt(encrypted, credentialsKey(), CREDENTIALS_AAD, "The held credentials are corrupted.")) as PendingInviteCredentials;
}

/**
 * Creates the account on the invitation's media server. Kept free of AuthService so the
 * post-payment hook in AuthService can use it without a dependency cycle.
 */
@Injectable()
export class InviteFulfillmentService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	/**
	 * Provisions the linked media server for one redemption.
	 * When `requireVerification` is true:
	 * - Jellyfin and Emby accounts are created disabled (`IsDisabled: true`) and enabled once the user verifies their email.
	 * - Plex shares are held (with the encrypted OAuth token) until email verification, because Plex shares cannot be disabled once accepted.
	 */
	async fulfill(usage: InvitationUsage, invitation: Invitation, credentials: PendingInviteCredentials, options?: { requireVerification?: boolean }): Promise<ExternalAccountResult | null> {
		const { primary } = await this.fulfillAll(usage, invitation, credentials, options);
		return primary;
	}

	/**
	 * Provisions all external media servers on an invitation (single- or multi-service)
	 * and records each result in `user_linked_accounts`.
	 */
	async fulfillAll(
		usage: InvitationUsage,
		invitation: Invitation,
		credentials: PendingInviteCredentials,
		options?: { requireVerification?: boolean; toleratePartialFailure?: boolean; skipPlex?: boolean },
	): Promise<{ primary: ExternalAccountResult | null; linkedResults: LinkedServiceOutcome[] }> {
		const servers = invitationTargetServers(invitation).filter((s) => !(options?.skipPlex && s.type === "plex"));
		const requireVerification = Boolean(options?.requireVerification);
		const toleratePartial = Boolean(options?.toleratePartialFailure) || servers.length > 1;
		const linkedResults: LinkedServiceOutcome[] = [];
		let primary: ExternalAccountResult | null = null;

		for (const server of servers) {
			try {
				const { result, outcome } = await this.provisionOneServer(usage, invitation, server, credentials, requireVerification);
				linkedResults.push(outcome);
				if (!primary && result) {
					primary = result;
					usage.externalUserId = result.externalUserId;
					usage.externalEmail = result.invitedEmail;
				}
			} catch (error) {
				if (!toleratePartial) {
					throw error;
				}
				const message = error instanceof Error ? error.message : "The media server refused the account.";
				await this.upsertLinkedAccount(usage.userId, server.id, {
					externalUserId: null,
					externalUsername: usage.username,
					externalEmail: credentials.email || null,
					status: "failed",
					error: message,
					pendingCredentials: null,
				});
				linkedResults.push({
					serverId: server.id,
					name: server.name,
					type: server.type,
					url: server.externalUrl?.trim() || server.url,
					status: "failed",
					alreadyLinked: false,
					invitedByEmail: false,
					error: message,
				});
			}
		}

		const anyFailed = linkedResults.some((r) => r.status === "failed");
		const anyPending = linkedResults.some((r) => r.status === "pending_verification");
		const hasPendingPlex = servers.some((s) => requireVerification && s.type === "plex");
		usage.status = anyPending || requireVerification ? "pending_verification" : anyFailed && linkedResults.every((r) => r.status === "failed") ? "failed" : "completed";
		usage.error = linkedResults.find((r) => r.error)?.error ?? null;
		usage.pendingCredentials = hasPendingPlex ? encryptPendingCredentials(credentials) : null;
		await this.dataSource.getRepository(InvitationUsage).save(usage);
		return { primary, linkedResults };
	}

	private async provisionOneServer(
		usage: InvitationUsage,
		invitation: Invitation,
		server: InviteServer,
		credentials: PendingInviteCredentials,
		requireVerification: boolean,
	): Promise<{ result: ExternalAccountResult | null; outcome: LinkedServiceOutcome }> {
		const apiKey = server.apiKeyEncrypted ? decryptSecret(server.apiKeyEncrypted) : null;
		const serverUrl = server.externalUrl?.trim() || server.url;

		if (usage.userId) {
			const linkedRepo = this.dataSource.getRepository(UserLinkedAccount);
			const existing = typeof linkedRepo?.findOneBy === "function" ? await linkedRepo.findOneBy({ userId: usage.userId, serverId: server.id }) : null;
			if (existing && existing.status === "completed") {
				if (existing.externalUserId && (server.type === "jellyfin" || server.type === "emby")) {
					await grantExternalLibraryAccess(server.type, server.url, apiKey, existing.externalUserId, invitation.externalLibraryIds, invitation.allowDownloads).catch((err) =>
						logger().warn(`Could not merge library access on ${server.name}: ${err instanceof Error ? err.message : String(err)}`),
					);
				}
				return {
					result: { externalUserId: existing.externalUserId, invitedEmail: existing.externalEmail },
					outcome: {
						serverId: server.id,
						name: server.name,
						type: server.type,
						url: serverUrl,
						status: "completed",
						alreadyLinked: true,
						invitedByEmail: false,
						error: null,
					},
				};
			}
		}

		if (requireVerification && server.type === "plex") {
			await this.upsertLinkedAccount(usage.userId, server.id, {
				externalUserId: null,
				externalUsername: usage.username,
				externalEmail: credentials.email || null,
				status: "pending_verification",
				error: null,
				pendingCredentials: encryptPendingCredentials(credentials),
			});
			return {
				result: null,
				outcome: {
					serverId: server.id,
					name: server.name,
					type: server.type,
					url: serverUrl,
					status: "pending_verification",
					alreadyLinked: false,
					invitedByEmail: false,
					error: null,
				},
			};
		}

		const result = await provisionExternalAccount(server.type, server.url, apiKey, {
			username: usage.username,
			password: credentials.password,
			email: credentials.email,
			libraryIds: invitation.externalLibraryIds,
			allowDownloads: invitation.allowDownloads,
			disabled: requireVerification && (server.type === "jellyfin" || server.type === "emby" || server.type === "flixer"),
			plexUserToken: credentials.plexUserToken,
			disableOnlineMediaSources: invitation.disablePlexOnlineSources,
		});

		if (usage.userId && result.externalUserId && (server.type === "jellyfin" || server.type === "emby")) {
			await this.pushAvatarBestEffort(usage.userId, server, apiKey, result.externalUserId);
		}

		const status: LinkedAccountStatus = requireVerification ? "pending_verification" : "completed";
		await this.upsertLinkedAccount(usage.userId, server.id, {
			externalUserId: result.externalUserId,
			externalUsername: usage.username,
			externalEmail: result.invitedEmail,
			status,
			error: null,
			pendingCredentials: null,
			lastSyncedAt: new Date(),
		});

		return {
			result,
			outcome: {
				serverId: server.id,
				name: server.name,
				type: server.type,
				url: serverUrl,
				status,
				alreadyLinked: false,
				invitedByEmail: Boolean(result.invitedEmail && !result.inviteAccepted),
				error: null,
			},
		};
	}

	private async pushAvatarBestEffort(userId: string, server: InviteServer, apiKey: string | null, externalUserId: string): Promise<void> {
		try {
			const prefRepo = this.dataSource.getRepository(UserPreference);
			if (typeof prefRepo?.findOneBy !== "function") return;
			const pref = await prefRepo.findOneBy({ userId });
			if (!pref?.avatarFile) return;
			const buffer = await readAvatarFile(pref.avatarFile);
			if (!buffer) return;
			const mime = mimeForAvatarFile(pref.avatarFile);
			if (!mime) return;
			await uploadExternalUserAvatar(server.type, server.url, apiKey, externalUserId, buffer, mime);
		} catch (error) {
			logger().warn(`Could not sync Flixer avatar to ${server.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async upsertLinkedAccount(
		userId: string | null,
		serverId: string,
		fields: Partial<Pick<UserLinkedAccount, "externalUserId" | "externalUsername" | "externalEmail" | "status" | "error" | "pendingCredentials" | "lastSyncedAt">>,
	): Promise<void> {
		if (!userId) return;
		const repo = this.dataSource.getRepository(UserLinkedAccount);
		if (typeof repo?.findOneBy !== "function" || typeof repo?.save !== "function") return;
		const existing = await repo.findOneBy({ userId, serverId });
		if (existing) {
			Object.assign(existing, fields);
			await repo.save(existing);
			return;
		}
		await repo.save(
			repo.create({
				id: randomUUID(),
				userId,
				serverId,
				externalUserId: fields.externalUserId ?? null,
				externalUsername: fields.externalUsername ?? null,
				externalEmail: fields.externalEmail ?? null,
				status: fields.status ?? "completed",
				error: fields.error ?? null,
				pendingCredentials: fields.pendingCredentials ?? null,
				lastSyncedAt: fields.lastSyncedAt ?? null,
			}),
		);
	}

	/**
	 * Finishes redemptions that waited for the signup payment. Called after the fee clears; a
	 * refusing media server is recorded on the usage instead of blocking the sign-in.
	 */
	async fulfillPendingForUser(userId: string, options?: { isEmailVerificationRequired?: boolean }): Promise<{ destination: InviteDestination; verificationRequired: boolean } | null> {
		const usages = await this.dataSource.getRepository(InvitationUsage).find({
			where: { userId, status: "pending_payment" },
			relations: { invitation: { server: true } },
		});

		let outcome: { destination: InviteDestination; verificationRequired: boolean } | null = null;
		for (const usage of usages) {
			const invitation = usage.invitation;
			if (!invitation) {
				continue;
			}
			const verificationRequired = Boolean(options?.isEmailVerificationRequired && !invitation.skipEmailVerification);
			try {
				const credentials = usage.pendingCredentials ? decryptPendingCredentials(usage.pendingCredentials) : { password: "", email: "" };
				const result = await this.fulfill(usage, invitation, credentials, { requireVerification: verificationRequired });
				outcome = {
					destination: buildInviteDestination(invitation, Boolean(result?.invitedEmail && !result.inviteAccepted)),
					verificationRequired,
				};
			} catch (error) {
				usage.status = "failed";
				usage.error = error instanceof Error ? error.message : "The media server refused the account.";
				usage.pendingCredentials = null;
				await this.dataSource.getRepository(InvitationUsage).save(usage);
				outcome = { destination: buildInviteDestination(invitation, false), verificationRequired };
				logger().error(`Invite fulfilment for user ${userId} failed.`, error);
			}
		}
		return outcome;
	}

	/**
	 * Activates invited media server accounts once the user verifies their email:
	 * - Enables disabled Jellyfin/Emby accounts (`IsDisabled: false`).
	 * - Sends and auto-accepts held Plex server shares using the stored Plex OAuth token.
	 */
	async fulfillVerifiedForUser(userId: string): Promise<InviteDestination | null> {
		const usages = await this.dataSource.getRepository(InvitationUsage).find({
			where: { userId, status: "pending_verification" },
			relations: { invitation: { server: true } },
		});

		let destination: InviteDestination | null = null;
		for (const usage of usages) {
			const invitation = usage.invitation;
			if (!invitation) {
				continue;
			}
			const server = invitation.server;
			try {
				if (invitation.serverId && server && server.type !== "other") {
					const apiKey = server.apiKeyEncrypted ? decryptSecret(server.apiKeyEncrypted) : null;
					if ((server.type === "jellyfin" || server.type === "emby" || server.type === "flixer") && usage.externalUserId) {
						await setExternalAccountDisabled(server.type, server.url, apiKey, usage.externalUserId, false);
						usage.status = "completed";
						usage.error = null;
						usage.pendingCredentials = null;
						await this.dataSource.getRepository(InvitationUsage).save(usage);
						destination = buildInviteDestination(invitation, false);
						continue;
					}
					if (server.type === "plex") {
						const credentials = usage.pendingCredentials ? decryptPendingCredentials(usage.pendingCredentials) : { password: "", email: usage.externalEmail ?? "" };
						const result = await this.fulfill(usage, invitation, credentials, { requireVerification: false });
						destination = buildInviteDestination(invitation, Boolean(result?.invitedEmail && !result.inviteAccepted));
						continue;
					}
				}
				usage.status = "completed";
				usage.error = null;
				usage.pendingCredentials = null;
				await this.dataSource.getRepository(InvitationUsage).save(usage);
				destination = buildInviteDestination(invitation, false);
			} catch (error) {
				usage.status = "failed";
				usage.error = error instanceof Error ? error.message : "Could not activate the media server account.";
				usage.pendingCredentials = null;
				await this.dataSource.getRepository(InvitationUsage).save(usage);
				destination = buildInviteDestination(invitation, false);
				logger().error(`Post-verification invite activation for user ${userId} failed.`, error);
			}
		}
		return destination;
	}

	/**
	 * Removes linked Jellyfin, Emby and Plex accounts created for this Flixer user.
	 * Called before deleting a Flixer account; external errors are logged so an offline server cannot trap deletions.
	 */
	async deprovisionForUser(userId: string): Promise<void> {
		const handledServerIds = new Set<string>();
		const linkedAccounts = await this.dataSource.getRepository(UserLinkedAccount).find({
			where: { userId, status: In(["completed", "pending_verification"]) },
			relations: { server: true },
		});

		for (const linked of linkedAccounts) {
			const server = linked.server;
			if (!server || server.type === "other" || !server.apiKeyEncrypted) {
				continue;
			}
			handledServerIds.add(server.id);
			if (linked.status === "pending_verification" && server.type === "plex" && !linked.externalUserId && !linked.externalEmail) {
				continue;
			}
			try {
				await deleteExternalAccount(server.type, server.url, decryptSecret(server.apiKeyEncrypted), {
					externalUserId: linked.externalUserId,
					externalEmail: linked.externalEmail,
					username: linked.externalUsername ?? "",
				});
			} catch (error) {
				logger().error(`Could not delete ${server.type} account for user ${linked.externalUsername ?? userId} on "${server.name}".`, error);
			}
		}

		const usages = await this.dataSource.getRepository(InvitationUsage).find({
			where: { userId, status: In(["completed", "pending_verification"]) },
			relations: { invitation: { server: true } },
		});

		for (const usage of usages) {
			const server = usage.invitation?.server;
			if (!server || handledServerIds.has(server.id) || server.type === "other" || !server.apiKeyEncrypted) {
				continue;
			}
			if (usage.status === "pending_verification" && server.type === "plex" && !usage.externalUserId && !usage.externalEmail) {
				continue;
			}
			try {
				await deleteExternalAccount(server.type, server.url, decryptSecret(server.apiKeyEncrypted), {
					externalUserId: usage.externalUserId,
					externalEmail: usage.externalEmail,
					username: usage.username,
				});
			} catch (error) {
				logger().error(`Could not delete ${server.type} account for user ${usage.username} on "${server.name}".`, error);
			}
		}
	}
}
