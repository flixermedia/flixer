import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Invitation } from "../../entities/invitation.entity.js";
import { InvitationUsage } from "../../entities/invitationUsage.entity.js";
import { appConfig } from "../../config/store/appConfig.js";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.js";
import { decryptSecret } from "./inviteSecrets.js";
import { buildInviteDestination, type InviteDestination } from "./inviteDestination.js";
import { deleteExternalAccount, provisionExternalAccount, setExternalAccountDisabled, type ExternalAccountResult } from "./mediaServerClient.js";

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
		const server = invitation.server;
		const requireVerification = Boolean(options?.requireVerification);
		let result: ExternalAccountResult | null = null;

		if (invitation.serverId && server) {
			if (requireVerification && server.type === "plex") {
				usage.status = "pending_verification";
				usage.error = null;
				usage.pendingCredentials = encryptPendingCredentials(credentials);
				await this.dataSource.getRepository(InvitationUsage).save(usage);
				return null;
			}

			result = await provisionExternalAccount(server.type, server.url, server.apiKeyEncrypted ? decryptSecret(server.apiKeyEncrypted) : null, {
				username: usage.username,
				password: credentials.password,
				email: credentials.email,
				libraryIds: invitation.externalLibraryIds,
				allowDownloads: invitation.allowDownloads,
				disabled: requireVerification && (server.type === "jellyfin" || server.type === "emby"),
				plexUserToken: credentials.plexUserToken,
				disableOnlineMediaSources: invitation.disablePlexOnlineSources,
			});
			usage.externalUserId = result.externalUserId;
			usage.externalEmail = result.invitedEmail;
		}

		usage.status = requireVerification ? "pending_verification" : "completed";
		usage.error = null;
		usage.pendingCredentials = null;
		await this.dataSource.getRepository(InvitationUsage).save(usage);
		return result;
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
					if ((server.type === "jellyfin" || server.type === "emby") && usage.externalUserId) {
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
		const usages = await this.dataSource.getRepository(InvitationUsage).find({
			where: { userId, status: In(["completed", "pending_verification"]) },
			relations: { invitation: { server: true } },
		});

		for (const usage of usages) {
			const server = usage.invitation?.server;
			if (!server || server.type === "other" || !server.apiKeyEncrypted) {
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
