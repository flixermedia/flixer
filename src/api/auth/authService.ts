import { BadRequest, Conflict, Forbidden, NotFound, TooManyRequests, Unauthorized } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { getContext } from "@tsed/di";
import { tryCatch } from "@dschz/try-catch";
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { DataSource, MoreThan, Not } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { PasskeyCredential } from "../../entities/passkeyCredential.entity.js";
import { User, type UserRole } from "../../entities/user.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { UserSession } from "../../entities/userSession.entity.js";
import { AccountEmailService } from "./accountEmailService.js";
import { ApiKeyService } from "../apiKeys/apiKeyService.js";
import { deleteAvatarFile } from "./avatarStorage.js";
import { appConfig } from "../../config/store/appConfig.js";
import { EmailVerificationService } from "./emailVerificationService.js";

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const PASSWORD_SCRYPT_COST = 1 << 14;
const ACCESS_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const RESEND_COOLDOWN_MS = 60_000;
const PASSKEY_TICKET_LIFETIME_SECONDS = 5 * 60;
const LAST_SEEN_GRANULARITY_MS = 60_000;
const MAX_USER_AGENT_LENGTH = 512;

interface RequestContextLike {
	request?: { get(name: string): unknown; raw?: { ip?: string } };
}

/** Reads the caller's User-Agent and address from the current request, if there is one. */
function readClientInfo(): { userAgent: string | null; ipAddress: string | null } {
	const request = getContext<RequestContextLike>()?.request;
	if (!request) {
		return { userAgent: null, ipAddress: null };
	}

	const userAgent = request.get("user-agent");
	const forwarded = request.get("x-forwarded-for");
	const forwardedFor = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";

	return {
		userAgent: typeof userAgent === "string" && userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
		ipAddress: (forwardedFor || request.raw?.ip || "").slice(0, 64) || null,
	};
}

export interface AuthResult {
	accessToken: string;
	tokenType: "Bearer";
	expiresIn: number;
	session: {
		id: string;
		expiresAt: Date;
	};
	user: {
		id: string;
		username: string;
		displayName: string;
		email: string | null;
		role: UserRole;
	};
}

export interface VerificationPending {
	verificationRequired: true;
	email: string;
}

export interface PasskeyRequired {
	passkeyRequired: true;
	ticket: string;
}

export interface PublicUser {
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	emailVerified: boolean;
	pendingEmail: string | null;
	passkeyRequired: boolean;
	avatarUrl: string | null;
	role: UserRole;
	createdAt: Date;
}

export interface PublicSession {
	id: string;
	createdAt: Date;
	expiresAt: Date;
	current: boolean;
}

export interface AuthenticatedSession {
	user: User;
	session: UserSession;
}

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, PASSWORD_KEY_LENGTH, { N: PASSWORD_SCRYPT_COST, maxmem: 64 * 1024 * 1024 }, (error, key) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(key);
			},
		);
	});
}

function isUniqueViolation(error: unknown): boolean {

	if (typeof error !== "object" || error === null || !("driverError" in error)) {
		return false;
	}

	const driverError = error.driverError;

	return (
		typeof driverError === "object" && driverError !== null && "code" in driverError && driverError.code === "23505"
	);

}

@Injectable()
export class AuthService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly emailVerification: EmailVerificationService,
		private readonly accountEmail: AccountEmailService,
		private readonly apiKeys: ApiKeyService,
	) {}

	private readonly resendCooldowns = new Map<string, number>();

	static isUuid(value: string): boolean {
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
	}

	/** Allows a signed-in administrator or an API key that belongs to one. */
	async requireAdmin(authorization?: string): Promise<void> {
		const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
		if (token && this.apiKeys.isApiKey(token)) {
			const owner = await this.apiKeys.authenticate(token);
			if (owner.role !== "admin") {
				throw new Forbidden("Administrator access is required.");
			}
			return;
		}

		await this.requireAdminSession(authorization);
	}

	/** Requires a real login session; used for actions an API key must not perform. */
	async requireAdminSession(authorization?: string): Promise<AuthenticatedSession> {
		const authenticated = await this.requireAuthenticatedSession(authorization);
		if (authenticated.user.role !== "admin") {
			throw new Forbidden("Administrator access is required.");
		}
		return authenticated;
	}

	/** Resolves the caller from either an API key (acting as its owner) or a login session. */
	async getUserFromKeyOrSession(authorization?: string): Promise<PublicUser> {
		const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
		if (token && this.apiKeys.isApiKey(token)) {
			return this.toPublicUser(await this.apiKeys.authenticate(token));
		}

		return this.getAuthenticatedUser(authorization);
	}

	async getAuthenticatedUser(authorization?: string): Promise<PublicUser> {
		const { user } = await this.requireAuthenticatedSession(authorization);
		return this.toPublicUser(user);
	}

	async updateProfile(authorization: string | undefined, changes: { displayName?: string; email?: string }): Promise<PublicUser> {
		const { user } = await this.requireAuthenticatedSession(authorization);
		const displayName = changes.displayName?.trim();
		if (changes.displayName !== undefined && !displayName) {
			throw new BadRequest("Display name cannot be empty.");
		}
		if (displayName) {
			user.displayName = displayName;
		}
		const requestedEmail = changes.email !== undefined ? this.normalizeEmail(changes.email) : undefined;
		let verificationTarget: string | undefined;
		if (requestedEmail !== undefined && requestedEmail !== user.email) {
			if (await this.emailVerification.isRequired()) {
				const taken = await this.dataSource.getRepository(User).findOneBy({ email: requestedEmail });
				if (taken) {
					throw new Conflict("An account with this email already exists.");
				}
				user.pendingEmail = requestedEmail;
				verificationTarget = requestedEmail;
			} else {
				user.email = requestedEmail;
				user.emailVerifiedAt = new Date();
			}
		} else if (requestedEmail !== undefined) {
			user.pendingEmail = null;
		}

		const [saveError, saved] = await tryCatch(() => this.dataSource.getRepository(User).save(user));
		if (saveError) {
			if (isUniqueViolation(saveError)) {
				throw new Conflict("An account with this email already exists.");
			}
			throw saveError;
		}
		if (verificationTarget) {
			await this.emailVerification.sendVerificationEmail(saved, verificationTarget);
		}

		return this.toPublicUser(saved);
	}

	async assertPassword(authorization: string | undefined, password: string | undefined): Promise<void> {
		const { user } = await this.requireAuthenticatedSession(authorization);
		if (!password || !(await this.verifyPassword(password, user.passwordHash))) {
			throw new Unauthorized("Your password is incorrect.");
		}
	}

	async changePassword(authorization: string | undefined, currentPassword: string, newPassword: string): Promise<{ changed: true }> {
		const { user, session } = await this.requireAuthenticatedSession(authorization);
		if (!(await this.verifyPassword(currentPassword, user.passwordHash))) {
			throw new Unauthorized("Your current password is incorrect.");
		}
		if (currentPassword === newPassword) {
			throw new BadRequest("The new password must be different from your current password.");
		}

		const salt = randomBytes(PASSWORD_SALT_LENGTH);
		const passwordKey = await derivePasswordKey(newPassword, salt);
		user.passwordHash = `scrypt$${salt.toString("base64url")}$${passwordKey.toString("base64url")}`;

		await this.dataSource.transaction(async (manager) => {
			await manager.getRepository(User).save(user);
			await manager.getRepository(UserSession).delete({ userId: user.id, id: Not(session.id) });
		});

		return { changed: true };
	}

	async deleteAccount(authorization: string | undefined, password: string): Promise<{ deleted: true }> {
		const { user } = await this.requireAuthenticatedSession(authorization);
		if (!(await this.verifyPassword(password, user.passwordHash))) {
			throw new Unauthorized("Your password is incorrect.");
		}
		if (user.role === "admin") {
			const admins = await this.dataSource.getRepository(User).count({ where: { role: "admin" } });
			if (admins <= 1) {
				throw new Forbidden("You are the only administrator. Promote another user before deleting your account.");
			}
		}

		await this.dataSource.getRepository(User).delete({ id: user.id });
		await deleteAvatarFile(user.preferences?.avatarFile);
		void this.accountEmail.sendAccountDeletedEmail(user);
		return { deleted: true };
	}

	async register(username: string, password: string, email: string, displayName: string | undefined, authorization?: string): Promise<AuthResult | VerificationPending> {
		const tokenSecret = this.getTokenSecret();
		const normalizedUsername = this.normalizeUsername(username);
		const normalizedEmail = this.normalizeEmail(email);
		const verificationRequired = await this.emailVerification.isRequired();
		const user = this.dataSource.getRepository(User).create({
			id: randomUUID(),
			username: normalizedUsername,
			displayName: displayName?.trim() || username.trim(),
			email: normalizedEmail,
			role: "user",
			emailVerifiedAt: verificationRequired ? null : new Date(),
			passwordHash: await this.hashPassword(password),
		});

		const [saveError] = await tryCatch(() =>
			this.dataSource.transaction(async (manager) => {
				await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["flixer:first-user-admin"]);
				const users = manager.getRepository(User);
				const userCount = await users.count();
				const registrationSetting = await manager
					.getRepository(Setting)
					.findOneBy({ key: "registration_enabled" });
				if (!registrationSetting || typeof registrationSetting.value !== "boolean") {
					throw new Error("The registration_enabled setting is missing or invalid.");
				}
				if (!registrationSetting.value && userCount > 0) {
					if (!authorization) {
						throw new Forbidden("Public registration is disabled. An administrator must create accounts.");
					}
					await this.requireAdmin(authorization);
				}

				user.role = userCount === 0 ? "admin" : "user";
				await users.save(user);
			}),
		);
		if (saveError) {
			if (isUniqueViolation(saveError)) {
				throw new Conflict("An account with this username or email already exists.");
			}

			throw saveError;
		}

		if (await this.emailVerification.isRequired()) {
			await this.trySendVerification(user);
			return { verificationRequired: true, email: normalizedEmail };
		}

		return this.createAuthResult(user, tokenSecret);
	}

	async verifyEmail(token: string): Promise<{ verified: true }> {
		return this.emailVerification.verify(token);
	}

	async resendVerification(username: string, password: string): Promise<{ sent: true }> {
		const user = await this.dataSource.getRepository(User).findOneBy({ username: this.normalizeUsername(username) });
		if (!user || !(await this.verifyPassword(password, user.passwordHash))) {
			throw new Unauthorized("Invalid username or password.");
		}
		if (user.emailVerifiedAt) {
			return { sent: true };
		}

		const lastSent = this.resendCooldowns.get(user.id) ?? 0;
		if (Date.now() - lastSent < RESEND_COOLDOWN_MS) {
			throw new TooManyRequests("Please wait a minute before requesting another verification email.");
		}
		this.resendCooldowns.set(user.id, Date.now());
		const [sendError] = await tryCatch(() => this.emailVerification.sendVerificationEmail(user));
		if (sendError) {
			this.resendCooldowns.delete(user.id);
			throw sendError;
		}

		return { sent: true };
	}

	private async trySendVerification(user: User): Promise<void> {
		const [error] = await tryCatch(() => this.emailVerification.sendVerificationEmail(user));
		if (error) {
			console.error("[auth] failed to send verification email", error);
		}
	}

	async getUser(id: string, authorization?: string): Promise<PublicUser> {
		const { user: actor } = await this.requireAuthenticatedSession(authorization);
		this.assertUserId(id);
		const userId = id.toLowerCase();

		if (actor.role !== "admin" && actor.id !== userId) {
			throw new Forbidden("You can only view your own account.");
		}

		const user = await this.dataSource.getRepository(User).findOneBy({ id: userId });
		if (!user) {
			throw new NotFound("User not found.");
		}

		return this.toPublicUser(user);
	}

	async listUsers(authorization?: string): Promise<PublicUser[]> {
		await this.requireAdmin(authorization);
		const users = await this.dataSource.getRepository(User).find({
			order: { createdAt: "DESC" },
		});

		return users.map((user) => this.toPublicUser(user));
	}

	async deleteUser(id: string, authorization?: string, password?: string): Promise<{ id: string; deleted: true }> {
		const { user: actor } = await this.requireAuthenticatedSession(authorization);
		this.assertUserId(id);
		const userId = id.toLowerCase();

		if (actor.role !== "admin" && actor.id !== userId) {
			throw new Forbidden("You can only delete your own account.");
		}

		const repository = this.dataSource.getRepository(User);
		const target = await repository.findOneBy({ id: userId });
		if (!target) {
			throw new NotFound("User not found.");
		}

		if (actor.role !== "admin" && (!password || !(await this.verifyPassword(password, actor.passwordHash)))) {
			throw new Unauthorized("Your current password is required to delete your account.");
		}

		await repository.remove(target);
		return { id: target.id, deleted: true };
	}

	async listSessions(authorization?: string): Promise<PublicSession[]> {
		const { user, session } = await this.requireAuthenticatedSession(authorization);
		const sessions = await this.dataSource.getRepository(UserSession).find({
			where: { userId: user.id, expiresAt: MoreThan(new Date()) },
			order: { createdAt: "DESC" },
		});

		return sessions.map((item) => ({
			id: item.id,
			createdAt: item.createdAt,
			expiresAt: item.expiresAt,
			current: item.id === session.id,
		}));
	}

	async revokeSession(sessionId: string, authorization?: string): Promise<{ id: string; revoked: true }> {
		const { user } = await this.requireAuthenticatedSession(authorization);
		this.assertSessionId(sessionId);
		const id = sessionId.toLowerCase();
		const repository = this.dataSource.getRepository(UserSession);
		const session = await repository.findOneBy({ id, userId: user.id });

		if (!session) {
			throw new NotFound("Session not found.");
		}

		await repository.remove(session);
		return { id, revoked: true };
	}

	async logout(authorization?: string): Promise<{ id: string; loggedOut: true }> {
		const { session } = await this.requireAuthenticatedSession(authorization);
		await this.dataSource.getRepository(UserSession).delete({ id: session.id });
		return { id: session.id, loggedOut: true };
	}

	private async requireAuthenticatedSession(authorization?: string): Promise<AuthenticatedSession> {
		const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization ?? "");
		if (!match) {
			throw new Unauthorized("A valid bearer access token is required.");
		}

		const secret = this.getTokenSecret();
		const [encodedHeader, encodedClaims, encodedSignature] = match[1].split(".");
		const expectedSignature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedClaims}`).digest();
		const actualSignature = Buffer.from(encodedSignature, "base64url");

		if (
			actualSignature.length !== expectedSignature.length ||
			!timingSafeEqual(actualSignature, expectedSignature)
		) {
			throw new Unauthorized("Invalid access token.");
		}

		const [parseError, token] = tryCatch(() => ({
			header: JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as unknown,
			claims: JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")) as unknown,
		}));
		if (parseError) {
			throw new Unauthorized("Invalid access token.");
		}
		const { header, claims } = token;

		if (
			typeof header !== "object" ||
			header === null ||
			!("alg" in header) ||
			header.alg !== "HS256" ||
			typeof claims !== "object" ||
			claims === null ||
			!("sub" in claims) ||
			typeof claims.sub !== "string" ||
			!("sid" in claims) ||
			typeof claims.sid !== "string" ||
			!("exp" in claims) ||
			typeof claims.exp !== "number" ||
			claims.exp <= Math.floor(Date.now() / 1000)
		) {
			throw new Unauthorized("Invalid or expired access token.");
		}

		const session = await this.dataSource.getRepository(UserSession).findOneBy({
			id: claims.sid,
			userId: claims.sub,
			expiresAt: MoreThan(new Date()),
		});

		if (!session) {
			throw new Unauthorized("This session is no longer active.");
		}

		const user = await this.dataSource.getRepository(User).findOneBy({ id: claims.sub });
		if (!user) {
			throw new Unauthorized("The account for this access token no longer exists.");
		}
		if (user.disabledAt) {
			throw new Unauthorized("This account has been disabled.");
		}

		if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_GRANULARITY_MS) {
			session.lastSeenAt = new Date();
			const { userAgent, ipAddress } = readClientInfo();
			const changes = { lastSeenAt: session.lastSeenAt, ...(userAgent && { userAgent }), ...(ipAddress && { ipAddress }) };
			await this.dataSource.getRepository(UserSession).update({ id: session.id }, changes);
		}

		return { user, session };
	}

	private assertUserId(id: string): void {
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
			throw new BadRequest("User ID must be a valid UUID.");
		}
	}

	private assertSessionId(id: string): void {
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
			throw new BadRequest("Session ID must be a valid UUID.");
		}
	}

	private toPublicUser(user: User): PublicUser {
		return {
			id: user.id,
			username: user.username,
			displayName: user.displayName ?? user.username,
			email: user.email,
			emailVerified: user.emailVerifiedAt !== null,
			pendingEmail: user.pendingEmail,
			passkeyRequired: user.preferences?.passkeyRequired ?? false,
			avatarUrl: user.preferences?.avatarFile ? `/auth/avatars/${user.preferences.avatarFile}` : null,
			role: user.role,
			createdAt: user.createdAt,
		};
	}

	toPublicUserFor(user: User): PublicUser {
		return this.toPublicUser(user);
	}

	async issueAuthResult(user: User): Promise<AuthResult> {
		return this.createAuthResult(user, this.getTokenSecret());
	}

	async login(username: string, password: string): Promise<AuthResult | PasskeyRequired> {
		const tokenSecret = this.getTokenSecret();
		const normalizedUsername = this.normalizeUsername(username);
		const user = await this.dataSource.getRepository(User).findOneBy({ username: normalizedUsername });

		if (!user || !(await this.verifyPassword(password, user.passwordHash))) {
			throw new Unauthorized("Invalid username or password.");
		}

		if (user.disabledAt) {
			throw new Forbidden("This account has been disabled. Contact your server administrator.");
		}

		if (!user.emailVerifiedAt && (await this.emailVerification.isRequired())) {
			throw new Forbidden("Please verify your email address before signing in.");
		}

		if (user.preferences?.passkeyRequired && (await this.dataSource.getRepository(PasskeyCredential).existsBy({ userId: user.id }))) {
			return { passkeyRequired: true, ticket: this.createPasskeyTicket(user.id) };
		}

		return this.createAuthResult(user, tokenSecret);
	}

	async setPasskeyRequired(authorization: string | undefined, enabled: boolean, password?: string): Promise<PublicUser> {
		const { user } = await this.requireAuthenticatedSession(authorization);
		if (!enabled && user.preferences?.passkeyRequired && (!password || !(await this.verifyPassword(password, user.passwordHash)))) {
			throw new Unauthorized("Your password is incorrect.");
		}
		if (enabled && !(await this.dataSource.getRepository(PasskeyCredential).existsBy({ userId: user.id }))) {
			throw new BadRequest("Add a passkey before requiring one at sign-in.");
		}

		await this.dataSource.getRepository(UserPreference).upsert({ userId: user.id, passkeyRequired: enabled }, ["userId"]);
		return this.toPublicUser(await this.dataSource.getRepository(User).findOneByOrFail({ id: user.id }));
	}

	/** Short-lived proof that the password step succeeded, exchanged for a session after a passkey check. */
	createPasskeyTicket(userId: string): string {
		const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + PASSKEY_TICKET_LIFETIME_SECONDS })).toString("base64url");
		return `${payload}.${this.signPasskeyTicket(payload)}`;
	}

	readPasskeyTicket(ticket: string): string {
		const [payload, signature, extra] = ticket.split(".");
		if (!payload || !signature || extra !== undefined) {
			throw new Unauthorized("Your sign-in expired. Enter your password again.");
		}

		const expected = Buffer.from(this.signPasskeyTicket(payload));
		const actual = Buffer.from(signature);
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
			throw new Unauthorized("Your sign-in expired. Enter your password again.");
		}

		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
		if (typeof claims.sub !== "string" || typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) {
			throw new Unauthorized("Your sign-in expired. Enter your password again.");
		}

		return claims.sub;
	}

	private signPasskeyTicket(payload: string): string {
		return createHmac("sha256", this.getTokenSecret()).update(`passkey-ticket.${payload}`).digest("base64url");
	}

	private normalizeEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	private normalizeUsername(username: string): string {
		return username.trim().toLowerCase();
	}

	private getTokenSecret(): string {
		const secret = appConfig().get("jwtSecret");

		if (!secret || Buffer.byteLength(secret) < 32) {
			throw new Error("JWT_SECRET must be set to at least 32 bytes to issue access tokens.");
		}

		return secret;
	}

	async hashPassword(password: string): Promise<string> {
		const salt = randomBytes(PASSWORD_SALT_LENGTH);
		const key = await derivePasswordKey(password, salt);
		return ["scrypt", salt.toString("base64url"), key.toString("base64url")].join("$");
	}

	normalizeIdentity(value: string): string {
		return value.trim().toLowerCase();
	}

	private async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
		const [algorithm, saltValue, keyValue] = passwordHash.split("$");
		if (algorithm !== "scrypt" || !saltValue || !keyValue) {
			return false;
		}

		const salt = Buffer.from(saltValue, "base64url");
		const expectedKey = Buffer.from(keyValue, "base64url");
		if (salt.length !== PASSWORD_SALT_LENGTH || expectedKey.length !== PASSWORD_KEY_LENGTH) {
			return false;
		}

		const actualKey = await derivePasswordKey(password, salt);
		return timingSafeEqual(actualKey, expectedKey);
	}

	private async createAuthResult(user: User, secret: string): Promise<AuthResult> {
		if (user.disabledAt) {
			throw new Forbidden("This account has been disabled. Contact your server administrator.");
		}
		const issuedAt = Math.floor(Date.now() / 1000);
		const expiresAt = new Date((issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS) * 1000);
		const { userAgent, ipAddress } = readClientInfo();
		const session = await this.dataSource.getRepository(UserSession).save(
			this.dataSource.getRepository(UserSession).create({
				id: randomUUID(),
				userId: user.id,
				expiresAt,
				userAgent,
				ipAddress,
			}),
		);
		const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
		const payload = Buffer.from(
			JSON.stringify({
				sub: user.id,
				sid: session.id,
				iat: issuedAt,
				exp: issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS,
			}),
		).toString("base64url");
		const unsignedToken = `${header}.${payload}`;
		const signature = createHmac("sha256", secret).update(unsignedToken).digest("base64url");

		return {
			accessToken: `${unsignedToken}.${signature}`,
			tokenType: "Bearer",
			expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
			session: {
				id: session.id,
				expiresAt: session.expiresAt,
			},
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName ?? user.username,
				email: user.email,
				role: user.role,
			},
		};
	}
}
