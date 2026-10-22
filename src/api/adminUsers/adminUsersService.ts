import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, Forbidden, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, MoreThan } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PasskeyCredential } from "../../entities/passkeyCredential.entity.js";
import { User, type UserRole } from "../../entities/user.entity.js";
import { UserSession } from "../../entities/userSession.entity.js";
import { AuthService } from "../auth/authService.js";
import { AvatarService } from "../auth/avatarService.js";
import { deleteAvatarFile } from "../auth/avatarStorage.js";
import type { CreateAdminUserRequest, UpdateAdminUserRequest } from "./adminUserRequests.js";

export interface AdminUser {
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	emailVerified: boolean;
	role: UserRole;
	disabled: boolean;
	passkeys: number;
	activeSessions: number;
	lastActiveAt: Date | null;
	createdAt: Date;
	avatarUrl: string | null;
	current: boolean;
}

interface UserStats {
	passkeys: number;
	activeSessions: number;
	lastActiveAt: Date | null;
	currentUserId: string;
}

function isUniqueViolation(error: unknown): boolean {
	const driverError = typeof error === "object" && error !== null && "driverError" in error ? error.driverError : undefined;
	return typeof driverError === "object" && driverError !== null && "code" in driverError && driverError.code === "23505";
}

/** User management for the admin dashboard. */
@Injectable()
export class AdminUsersService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
		private readonly avatars: AvatarService,
	) {}

	async list(currentUserId: string): Promise<AdminUser[]> {
		const users = await this.dataSource.getRepository(User).find({ order: { createdAt: "ASC" } });
		const passkeys = await this.dataSource
			.getRepository(PasskeyCredential)
			.createQueryBuilder("passkey")
			.select("passkey.user_id", "userId")
			.addSelect("COUNT(*)", "count")
			.groupBy("passkey.user_id")
			.getRawMany<{ userId: string; count: string }>();
		const sessions = await this.dataSource
			.getRepository(UserSession)
			.createQueryBuilder("session")
			.select("session.user_id", "userId")
			.addSelect("COUNT(*)", "count")
			.addSelect("MAX(session.last_seen_at)", "lastSeenAt")
			.where("session.expires_at > now()")
			.groupBy("session.user_id")
			.getRawMany<{ userId: string; count: string; lastSeenAt: Date | string }>();

		const passkeyCounts = new Map(passkeys.map((row) => [row.userId, Number(row.count)]));
		const sessionStats = new Map(sessions.map((row) => [row.userId, row]));

		return users.map((user) => {
			const stats = sessionStats.get(user.id);
			return this.toAdminUser(user, {
				passkeys: passkeyCounts.get(user.id) ?? 0,
				activeSessions: stats ? Number(stats.count) : 0,
				lastActiveAt: stats ? new Date(stats.lastSeenAt) : null,
				currentUserId,
			});
		});
	}

	async create(request: CreateAdminUserRequest, currentUserId: string): Promise<AdminUser> {
		const repository = this.dataSource.getRepository(User);
		const user = repository.create({
			id: randomUUID(),
			username: this.authService.normalizeIdentity(request.username),
			displayName: request.displayName?.trim() || request.username.trim(),
			email: this.authService.normalizeIdentity(request.email),
			role: request.role ?? "user",
			emailVerifiedAt: new Date(),
			passwordHash: await this.authService.hashPassword(request.password),
		});

		try {
			await repository.save(user);
		} catch (error: unknown) {
			if (isUniqueViolation(error)) {
				throw new Conflict("An account with this username or email already exists.");
			}
			throw error;
		}

		return this.toAdminUser(await repository.findOneByOrFail({ id: user.id }), { passkeys: 0, activeSessions: 0, lastActiveAt: null, currentUserId });
	}

	async update(id: string, request: UpdateAdminUserRequest, currentUserId: string): Promise<AdminUser> {
		const repository = this.dataSource.getRepository(User);
		const user = await this.find(id);
		const isSelf = user.id === currentUserId;

		if (request.displayName !== undefined) {
			const displayName = request.displayName.trim();
			if (!displayName) {
				throw new BadRequest("Display name cannot be empty.");
			}
			user.displayName = displayName;
		}
		if (request.email !== undefined) {
			const email = this.authService.normalizeIdentity(request.email);
			if (email !== user.email) {
				user.email = email;
				user.pendingEmail = null;
				user.emailVerifiedAt = new Date();
			}
		}

		let revokeSessions = false;
		if (request.role !== undefined && request.role !== user.role) {
			if (isSelf) {
				throw new Forbidden("You can't change your own role.");
			}
			user.role = request.role;
			revokeSessions = true;
		}
		if (request.disabled !== undefined && request.disabled !== (user.disabledAt !== null)) {
			if (isSelf) {
				throw new Forbidden("You can't disable your own account.");
			}
			user.disabledAt = request.disabled ? new Date() : null;
			revokeSessions ||= request.disabled;
		}

		try {
			await repository.save(user);
		} catch (error: unknown) {
			if (isUniqueViolation(error)) {
				throw new Conflict("An account with this email already exists.");
			}
			throw error;
		}
		if (revokeSessions) {
			await this.dataSource.getRepository(UserSession).delete({ userId: user.id });
		}

		return this.describe(await repository.findOneByOrFail({ id: user.id }), currentUserId);
	}

	async setAvatar(id: string, file: { buffer?: Buffer; size?: number } | undefined, currentUserId: string): Promise<AdminUser> {
		const user = await this.find(id);
		await this.avatars.setUserAvatar(user.id, file);
		return this.describe(await this.find(user.id), currentUserId);
	}

	async removeAvatar(id: string, currentUserId: string): Promise<AdminUser> {
		const user = await this.find(id);
		await this.avatars.clearUserAvatar(user.id);
		return this.describe(await this.find(user.id), currentUserId);
	}

	async setPassword(id: string, password: string): Promise<void> {
		const user = await this.find(id);
		await this.dataSource.getRepository(User).update({ id: user.id }, { passwordHash: await this.authService.hashPassword(password) });
		await this.dataSource.getRepository(UserSession).delete({ userId: user.id });
	}

	/** Signs the user out everywhere except the administrator's own current session. */
	async revokeSessions(id: string, currentSessionId: string): Promise<{ revoked: number }> {
		const user = await this.find(id);
		const sessions = this.dataSource.getRepository(UserSession);
		const active = await sessions.find({ where: { userId: user.id, expiresAt: MoreThan(new Date()) } });
		const ids = active.filter((session) => session.id !== currentSessionId).map((session) => session.id);
		if (ids.length > 0) {
			await sessions.delete(ids);
		}

		return { revoked: ids.length };
	}

	async remove(id: string, currentUserId: string): Promise<void> {
		const user = await this.find(id);
		if (user.id === currentUserId) {
			throw new Forbidden("You can't delete your own account here. Use your account settings instead.");
		}

		await this.dataSource.getRepository(User).remove(user);
		await deleteAvatarFile(user.preferences?.avatarFile);
	}

	private async find(id: string): Promise<User> {
		if (!AuthService.isUuid(id)) {
			throw new NotFound("User not found.");
		}

		const user = await this.dataSource.getRepository(User).findOneBy({ id: id.toLowerCase() });
		if (!user) {
			throw new NotFound("User not found.");
		}

		return user;
	}

	private async describe(user: User, currentUserId: string): Promise<AdminUser> {
		const [passkeys, sessions] = await Promise.all([
			this.dataSource.getRepository(PasskeyCredential).countBy({ userId: user.id }),
			this.dataSource.getRepository(UserSession).find({ where: { userId: user.id, expiresAt: MoreThan(new Date()) } }),
		]);
		const lastActiveAt = sessions.reduce<Date | null>((latest, session) => (!latest || session.lastSeenAt > latest ? session.lastSeenAt : latest), null);

		return this.toAdminUser(user, { passkeys, activeSessions: sessions.length, lastActiveAt, currentUserId });
	}

	private toAdminUser(user: User, stats: UserStats): AdminUser {
		return {
			id: user.id,
			username: user.username,
			displayName: user.displayName ?? user.username,
			email: user.email,
			emailVerified: user.emailVerifiedAt !== null,
			role: user.role,
			disabled: user.disabledAt !== null,
			passkeys: stats.passkeys,
			activeSessions: stats.activeSessions,
			lastActiveAt: stats.lastActiveAt,
			createdAt: user.createdAt,
			avatarUrl: user.preferences?.avatarFile ? `/auth/avatars/${user.preferences.avatarFile}` : null,
			current: user.id === stats.currentUserId,
		};
	}
}
