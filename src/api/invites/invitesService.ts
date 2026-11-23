import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { randomBytes, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Invitation } from "../../entities/invitation.entity.js";
import { InvitationUsage } from "../../entities/invitationUsage.entity.js";
import { InviteServer } from "../../entities/inviteServer.entity.js";
import { isUniqueViolation } from "../../utils/isUniqueViolation.js";
import { decryptSecret, encryptSecret } from "./inviteSecrets.js";
import { testMediaServerConnection, validatePlexServerVersion } from "./mediaServerClient.js";
import type { CreateInvitationRequest, CreateInviteServerRequest, UpdateInvitationRequest, UpdateInviteServerRequest } from "./inviteRequests.js";

/** Unambiguous alphabet (no 0/O/1/I) for generated invite codes. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GENERATED_CODE_LENGTH = 8;

export interface PublicInviteServer {
	id: string;
	name: string;
	type: InviteServer["type"];
	url: string;
	externalUrl: string | null;
	hasApiKey: boolean;
	instructions: string | null;
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdminInvitation {
	id: string;
	code: string;
	label: string | null;
	server: { id: string; name: string; type: InviteServer["type"] } | null;
	maxUses: number | null;
	usedCount: number;
	expiresAt: Date | null;
	disabled: boolean;
	libraryMode: Invitation["libraryMode"];
	libraryIds: string[];
	externalLibraryIds: string[];
	allowDownloads: boolean;
	skipPayment: boolean;
	skipEmailVerification: boolean;
	disablePlexOnlineSources: boolean;
	userExpiresInDays: number | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdminInvitationUsage {
	id: string;
	invitationId: string;
	userId: string | null;
	username: string;
	status: InvitationUsage["status"];
	externalUserId: string | null;
	externalEmail: string | null;
	error: string | null;
	expiresAt: Date | null;
	createdAt: Date;
}

function generateCode(): string {
	const bytes = randomBytes(GENERATED_CODE_LENGTH);
	let code = "";
	for (let index = 0; index < GENERATED_CODE_LENGTH; index += 1) {
		code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
	}
	return code;
}

@Injectable()
export class InvitesService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	// ---- Media servers -------------------------------------------------------------------------------------------

	private toPublicServer(server: InviteServer): PublicInviteServer {
		return {
			id: server.id,
			name: server.name,
			type: server.type,
			url: server.url,
			externalUrl: server.externalUrl ?? null,
			hasApiKey: !!server.apiKeyEncrypted,
			instructions: server.instructions,
			enabled: server.enabled,
			createdAt: server.createdAt,
			updatedAt: server.updatedAt,
		};
	}

	async listServers(): Promise<PublicInviteServer[]> {
		const servers = await this.dataSource.getRepository(InviteServer).find({ order: { createdAt: "ASC" } });
		return servers.map((server) => this.toPublicServer(server));
	}

	async createServer(request: CreateInviteServerRequest): Promise<PublicInviteServer> {
		const url = request.url.trim();
		const apiKey = request.apiKey?.trim() || null;
		if (request.type === "plex") {
			try {
				await validatePlexServerVersion(url, apiKey);
			} catch (error) {
				throw new BadRequest(error instanceof Error ? error.message : "Could not validate the Plex server.");
			}
		}
		const server = this.dataSource.getRepository(InviteServer).create({
			id: randomUUID(),
			name: request.name.trim(),
			type: request.type,
			url,
			externalUrl: request.externalUrl?.trim() || null,
			apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null,
			instructions: request.instructions?.trim() || null,
			enabled: request.enabled ?? true,
		});
		const [error] = await this.trySave(InviteServer, server);
		if (error) throw error;
		return this.toPublicServer(server);
	}

	async updateServer(id: string, request: UpdateInviteServerRequest): Promise<PublicInviteServer> {
		const server = await this.requireServer(id);
		const shouldValidatePlex = server.type === "plex" && (request.enabled ?? server.enabled) && (request.url !== undefined || request.apiKey !== undefined || request.enabled === true);
		if (request.name !== undefined) server.name = request.name.trim();
		if (request.url !== undefined) server.url = request.url.trim();
		if ("externalUrl" in request) server.externalUrl = request.externalUrl?.trim() || null;
		if (request.apiKey !== undefined) server.apiKeyEncrypted = request.apiKey.trim() ? encryptSecret(request.apiKey.trim()) : null;
		if (request.instructions !== undefined) server.instructions = request.instructions.trim() || null;
		if (request.enabled !== undefined) server.enabled = request.enabled;
		if (shouldValidatePlex) {
			try {
				await validatePlexServerVersion(server.url, server.apiKeyEncrypted ? decryptSecret(server.apiKeyEncrypted) : null);
			} catch (error) {
				throw new BadRequest(error instanceof Error ? error.message : "Could not validate the Plex server.");
			}
		}
		const [error] = await this.trySave(InviteServer, server);
		if (error) throw error;
		return this.toPublicServer(server);
	}

	/** Removing a server also removes its invitations and their usage history. */
	async deleteServer(id: string): Promise<void> {
		const server = await this.requireServer(id);
		await this.dataSource.getRepository(InviteServer).remove(server);
	}

	/** Verifies the saved URL and credentials reach the server; throws a BadRequest with the reason when they do not. */
	async testServer(id: string): Promise<{ ok: true }> {
		const server = await this.requireServer(id);
		try {
			await testMediaServerConnection(server.type, server.url, server.apiKeyEncrypted ? decryptSecret(server.apiKeyEncrypted) : null);
		} catch (error) {
			throw new BadRequest(error instanceof Error ? error.message : "The connection test failed.");
		}
		return { ok: true };
	}

	async requireServer(id: string): Promise<InviteServer> {
		const server = await this.dataSource.getRepository(InviteServer).findOneBy({ id });
		if (!server) {
			throw new NotFound("Media server not found.");
		}
		return server;
	}

	// ---- Invitations ---------------------------------------------------------------------------------------------

	/** The API shape of an invitation; the eager server relation is reduced so its secrets never serialize. */
	toAdminInvitation(invitation: Invitation): AdminInvitation {
		return {
			id: invitation.id,
			code: invitation.code,
			label: invitation.label,
			server: invitation.serverId && invitation.server ? { id: invitation.server.id, name: invitation.server.name, type: invitation.server.type } : null,
			maxUses: invitation.maxUses,
			usedCount: invitation.usedCount,
			expiresAt: invitation.expiresAt,
			disabled: invitation.disabled,
			libraryMode: invitation.libraryMode,
			libraryIds: invitation.libraryIds,
			externalLibraryIds: invitation.externalLibraryIds,
			allowDownloads: invitation.allowDownloads,
			skipPayment: invitation.skipPayment,
			skipEmailVerification: invitation.skipEmailVerification,
			disablePlexOnlineSources: invitation.disablePlexOnlineSources,
			userExpiresInDays: invitation.userExpiresInDays,
			createdAt: invitation.createdAt,
			updatedAt: invitation.updatedAt,
		};
	}

	async listInvitations(): Promise<AdminInvitation[]> {
		const invitations = await this.dataSource.getRepository(Invitation).find({ order: { createdAt: "DESC" } });
		return invitations.map((invitation) => this.toAdminInvitation(invitation));
	}

	async createInvitation(request: CreateInvitationRequest, createdBy: string): Promise<AdminInvitation> {
		const server = request.serverId ? await this.requireServer(request.serverId) : null;
		const repository = this.dataSource.getRepository(Invitation);
		const invitation = repository.create({
			id: randomUUID(),
			code: (request.code ?? generateCode()).toUpperCase(),
			label: request.label?.trim() || null,
			serverId: request.serverId ?? null,
			maxUses: request.maxUses ?? null,
			expiresAt: request.expiresAt ?? null,
			libraryMode: request.libraryMode ?? "all",
			libraryIds: request.libraryIds ?? [],
			externalLibraryIds: request.externalLibraryIds ?? [],
			allowDownloads: request.allowDownloads ?? true,
			skipPayment: request.skipPayment ?? false,
			skipEmailVerification: request.skipEmailVerification ?? false,
			disablePlexOnlineSources: request.disablePlexOnlineSources ?? server?.type === "plex",
			userExpiresInDays: request.userExpiresInDays ?? null,
			createdBy,
		});
		const [error] = await this.trySave(Invitation, invitation);
		if (error) throw error;
		return this.toAdminInvitation(await this.requireInvitation(invitation.id));
	}

	async updateInvitation(id: string, request: UpdateInvitationRequest): Promise<AdminInvitation> {
		const invitation = await this.requireInvitation(id);
		if (request.code !== undefined) invitation.code = request.code.trim().toUpperCase();
		if (request.label !== undefined) invitation.label = request.label?.trim() || null;
		if ("serverId" in request) {
			const nextServerId = request.serverId?.trim() || null;
			if (nextServerId !== invitation.serverId) {
				if (invitation.usedCount > 0) {
					throw new BadRequest("Destination server cannot be changed after an invitation has been used.");
				}
				if (nextServerId) {
					invitation.server = await this.requireServer(nextServerId);
					invitation.serverId = invitation.server.id;
				} else {
					invitation.server = null;
					invitation.serverId = null;
				}
			}
		}
		if ("maxUses" in request) invitation.maxUses = request.maxUses ?? null;
		if ("expiresAt" in request) invitation.expiresAt = request.expiresAt ? new Date(request.expiresAt) : null;
		if (request.disabled !== undefined) invitation.disabled = request.disabled;
		if (request.libraryMode !== undefined) invitation.libraryMode = request.libraryMode;
		if (request.libraryIds !== undefined) invitation.libraryIds = request.libraryIds;
		if (request.externalLibraryIds !== undefined) invitation.externalLibraryIds = request.externalLibraryIds;
		if (request.allowDownloads !== undefined) invitation.allowDownloads = request.allowDownloads;
		if (request.skipPayment !== undefined) invitation.skipPayment = request.skipPayment;
		if (request.skipEmailVerification !== undefined) invitation.skipEmailVerification = request.skipEmailVerification;
		if (request.disablePlexOnlineSources !== undefined) invitation.disablePlexOnlineSources = request.disablePlexOnlineSources;
		if ("userExpiresInDays" in request) invitation.userExpiresInDays = request.userExpiresInDays ?? null;
		const [error] = await this.trySave(Invitation, invitation);
		if (error) throw error;
		return this.toAdminInvitation(invitation);
	}

	async deleteInvitation(id: string): Promise<void> {
		const invitation = await this.requireInvitation(id);
		await this.dataSource.getRepository(Invitation).remove(invitation);
	}

	async requireInvitation(id: string): Promise<Invitation> {
		const invitation = await this.dataSource.getRepository(Invitation).findOneBy({ id });
		if (!invitation) {
			throw new NotFound("Invitation not found.");
		}
		return invitation;
	}

	async listUsages(invitationId: string): Promise<AdminInvitationUsage[]> {
		await this.requireInvitation(invitationId);
		const usages = await this.dataSource.getRepository(InvitationUsage).find({ where: { invitationId }, order: { createdAt: "DESC" } });
		return usages.map((usage) => ({
			id: usage.id,
			invitationId: usage.invitationId,
			userId: usage.userId,
			username: usage.username,
			status: usage.status,
			externalUserId: usage.externalUserId,
			externalEmail: usage.externalEmail,
			error: usage.error,
			expiresAt: usage.expiresAt,
			createdAt: usage.createdAt,
		}));
	}

	// ---- Redemption ----------------------------------------------------------------------------------------------

	/** Finds an existing, enabled invitation by code (even if its uses are exhausted, so existing invited users can resume). */
	async findActiveByCode(code: string): Promise<Invitation> {
		const invitation = await this.dataSource.getRepository(Invitation).findOneBy({ code: code.toUpperCase() });
		if (!invitation || invitation.disabled) {
			throw new NotFound("This invite does not exist or is no longer active.");
		}
		if (invitation.serverId && !invitation.server?.enabled) {
			throw new NotFound("This invite does not exist or is no longer active.");
		}
		return invitation;
	}

	/** A redeemable invitation, or the reason it cannot be redeemed. The code itself never leaks other details. */
	async findRedeemable(code: string): Promise<Invitation> {
		const invitation = await this.dataSource.getRepository(Invitation).findOneBy({ code: code.toUpperCase() });
		if (!invitation || invitation.disabled) {
			throw new NotFound("This invite does not exist or is no longer active.");
		}
		if (invitation.expiresAt && invitation.expiresAt.getTime() <= Date.now()) {
			throw new NotFound("This invite has expired.");
		}
		if (invitation.maxUses !== null && invitation.usedCount >= invitation.maxUses) {
			throw new NotFound("This invite has already been used.");
		}
		if (invitation.serverId && !invitation.server?.enabled) {
			throw new NotFound("This invite does not exist or is no longer active.");
		}
		return invitation;
	}

	/** Claims one use of the invitation, holding a row lock so simultaneous redemptions cannot exceed the limit. */
	async consume(code: string): Promise<Invitation> {
		const normalized = code.toUpperCase();
		const claimed = await this.dataSource.transaction(async (manager) => {
			const locked = await manager.getRepository(Invitation).createQueryBuilder("invitation").setLock("pessimistic_write").where("invitation.code = :code", { code: normalized }).getOne();
			if (!locked || locked.disabled) {
				throw new NotFound("This invite does not exist or is no longer active.");
			}
			if (locked.expiresAt && locked.expiresAt.getTime() <= Date.now()) {
				throw new NotFound("This invite has expired.");
			}
			if (locked.maxUses !== null && locked.usedCount >= locked.maxUses) {
				throw new NotFound("This invite has already been used.");
			}
			locked.usedCount += 1;
			await manager.getRepository(Invitation).save(locked);
			return locked;
		});
		// Reload outside the lock so the eager server relation is attached.
		const invitation = await this.requireInvitation(claimed.id);
		if (invitation.serverId && !invitation.server?.enabled) {
			await this.release(invitation.id);
			throw new NotFound("This invite does not exist or is no longer active.");
		}
		return invitation;
	}

	/** Returns a claimed use, for when redemption fails after `consume`. */
	async release(invitationId: string): Promise<void> {
		await this.dataSource
			.getRepository(Invitation)
			.createQueryBuilder()
			.update()
			.set({ usedCount: () => '"used_count" - 1' })
			.where("id = :id AND used_count > 0", { id: invitationId })
			.execute();
	}

	decryptServerApiKey(server: InviteServer): string | null {
		return server.apiKeyEncrypted ? decryptSecret(server.apiKeyEncrypted) : null;
	}

	private async trySave(entity: typeof InviteServer | typeof Invitation, value: InviteServer | Invitation): Promise<[Error | null]> {
		try {
			await this.dataSource.getRepository(entity).save(value);
			return [null];
		} catch (error) {
			if (isUniqueViolation(error)) {
				return [new Conflict(entity === InviteServer ? "A media server with this name already exists." : "An invitation with this code already exists.")];
			}
			return [error instanceof Error ? error : new Error(String(error))];
		}
	}
}
