import { logger } from "@tsed/di";
import { DataSource, In, IsNull, Not } from "typeorm";
import { deleteAvatarFile } from "../api/auth/avatar/avatarStorage.js";
import { decryptSecret } from "../api/invites/inviteSecrets.js";
import { listExternalAccounts } from "../api/invites/mediaServerClient.js";
import { InvitationUsage } from "../entities/invitationUsage.entity.js";
import type { InviteServer } from "../entities/inviteServer.entity.js";
import { User } from "../entities/user.entity.js";

export const INVITE_EXTERNAL_SYNC_JOB = "sync-external-invite-accounts";

/** Skip usages created within the last 30s so in-flight provisioning on external servers is never raced. */
const NEW_ACCOUNT_GRACE_MS = 30_000;

/**
 * Checks linked Jellyfin, Emby and Plex servers for invited accounts that were deleted externally
 * and removes the matching Flixer user so deletions stay in sync both ways.
 */
export async function syncExternalInviteAccounts(dataSource: DataSource, purgePayments?: (userId: string) => Promise<void>): Promise<{ checkedServers: number; deletedUsers: number }> {
	// Snapshot DB usages BEFORE querying external servers so accounts created mid-sync are never mistaken for missing.
	const usages = await dataSource.getRepository(InvitationUsage).find({
		where: { status: In(["completed", "pending_verification"]), userId: Not(IsNull()) },
		relations: { invitation: { server: true } },
	});

	const cutoff = Date.now() - NEW_ACCOUNT_GRACE_MS;
	const byServer = new Map<string, { server: InviteServer; usages: InvitationUsage[] }>();
	for (const usage of usages) {
		const server = usage.invitation?.server;
		if (!server || !server.enabled || server.type === "other" || !server.apiKeyEncrypted) {
			continue;
		}
		// Plex shares are only sent once email verification finishes, so pending_verification Plex rows are not on Plex yet.
		if (usage.status === "pending_verification" && server.type === "plex") {
			continue;
		}
		if (usage.createdAt && usage.createdAt.getTime() > cutoff) {
			continue;
		}
		const hasIdentifier = server.type === "plex" ? Boolean(usage.externalUserId || usage.externalEmail) : Boolean(usage.externalUserId);
		if (!hasIdentifier) {
			continue;
		}
		const group = byServer.get(server.id) ?? { server, usages: [] };
		group.usages.push(usage);
		byServer.set(server.id, group);
	}

	let checkedServers = 0;
	let deletedUsers = 0;
	const usersRepo = dataSource.getRepository(User);

	for (const { server, usages: serverUsages } of byServer.values()) {
		let apiKey: string;
		try {
			apiKey = decryptSecret(server.apiKeyEncrypted!);
		} catch (error) {
			logger().warn(`Could not decrypt API key for invite server ${server.name}; skipping external deletion sync.`, error);
			continue;
		}

		let accounts;
		try {
			accounts = await listExternalAccounts(server.type, server.url, apiKey);
		} catch (error) {
			logger().warn(`Could not list accounts on ${server.type} server "${server.name}"; skipping external deletion sync.`, error);
			continue;
		}
		if (!accounts) {
			continue;
		}
		checkedServers += 1;

		const existingIds = new Set(accounts.map((account) => account.id));
		const existingEmails = new Set(accounts.flatMap((account) => (account.email ? [account.email.toLowerCase()] : [])));

		for (const usage of serverUsages) {
			const stillExists = server.type === "plex" ? Boolean((usage.externalUserId && existingIds.has(usage.externalUserId)) || (usage.externalEmail && existingEmails.has(usage.externalEmail.toLowerCase()))) : Boolean(usage.externalUserId && existingIds.has(usage.externalUserId));
			if (stillExists || !usage.userId) {
				continue;
			}

			const user = await usersRepo.findOneBy({ id: usage.userId });
			if (!user || user.role === "admin") {
				continue;
			}

			if (purgePayments) {
				await purgePayments(user.id).catch((error: unknown) => logger().warn(`Could not purge payment records for synced deleted user ${user.username}.`, error));
			}
			await usersRepo.remove(user);
			await deleteAvatarFile(user.preferences?.avatarFile).catch(() => undefined);
			deletedUsers += 1;
			logger().info(`Deleted Flixer user "${user.username}" because their ${server.type} account on "${server.name}" was removed.`);
		}
	}

	return { checkedServers, deletedUsers };
}
