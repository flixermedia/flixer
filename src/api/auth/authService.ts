import { BadRequest, Conflict, Forbidden, NotFound, Unauthorized } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { tryCatch } from "@dschz/try-catch";
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { DataSource, MoreThan } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User, type UserRole } from "../../entities/user.entity.js";
import { UserSession } from "../../entities/userSession.entity.js";

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const PASSWORD_SCRYPT_COST = 1 << 14;
const ACCESS_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

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
		email: string | null;
		role: UserRole;
	};
}

export interface PublicUser {
	id: string;
	username: string;
	email: string | null;
	role: UserRole;
	createdAt: Date;
}

export interface PublicSession {
	id: string;
	createdAt: Date;
	expiresAt: Date;
	current: boolean;
}

interface AuthenticatedSession {
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

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async requireAdmin(authorization?: string): Promise<void> {
		const { user } = await this.requireAuthenticatedSession(authorization);
		if (user.role !== "admin") {
			throw new Forbidden("Administrator access is required.");
		}
	}

	async getAuthenticatedUser(authorization?: string): Promise<PublicUser> {
		const { user } = await this.requireAuthenticatedSession(authorization);
		return this.toPublicUser(user);
	}

	async register(username: string, password: string, email?: string): Promise<AuthResult> {
		const tokenSecret = this.getTokenSecret();
		const normalizedUsername = this.normalizeUsername(username);
		const normalizedEmail = email === undefined ? null : this.normalizeEmail(email);
		const salt = randomBytes(PASSWORD_SALT_LENGTH);
		const passwordKey = await derivePasswordKey(password, salt);
		const user = this.dataSource.getRepository(User).create({
			id: randomUUID(),
			username: normalizedUsername,
			email: normalizedEmail,
			role: "user",
			passwordHash: `scrypt$${salt.toString("base64url")}$${passwordKey.toString("base64url")}`,
		});

		const [saveError] = await tryCatch(() =>
			this.dataSource.transaction(async (manager) => {
				await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["flixer:first-user-admin"]);
				const users = manager.getRepository(User);
				user.role = (await users.count()) === 0 ? "admin" : "user";
				await users.save(user);
			}),
		);
		if (saveError) {
			if (isUniqueViolation(saveError)) {
				throw new Conflict("An account with this username or email already exists.");
			}

			throw saveError;
		}

		return this.createAuthResult(user, tokenSecret);
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
			email: user.email,
			role: user.role,
			createdAt: user.createdAt,
		};
	}

	async login(username: string, password: string): Promise<AuthResult> {
		const tokenSecret = this.getTokenSecret();
		const normalizedUsername = this.normalizeUsername(username);
		const user = await this.dataSource.getRepository(User).findOneBy({ username: normalizedUsername });

		if (!user || !(await this.verifyPassword(password, user.passwordHash))) {
			throw new Unauthorized("Invalid username or password.");
		}

		return this.createAuthResult(user, tokenSecret);
	}

	private normalizeEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	private normalizeUsername(username: string): string {
		return username.trim().toLowerCase();
	}

	private getTokenSecret(): string {
		const secret = process.env.JWT_SECRET;

		if (!secret || Buffer.byteLength(secret) < 32) {
			throw new Error("JWT_SECRET must be set to at least 32 bytes to issue access tokens.");
		}

		return secret;
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
		const issuedAt = Math.floor(Date.now() / 1000);
		const expiresAt = new Date((issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS) * 1000);
		const session = await this.dataSource.getRepository(UserSession).save(
			this.dataSource.getRepository(UserSession).create({
				id: randomUUID(),
				userId: user.id,
				expiresAt,
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
				email: user.email,
				role: user.role,
			},
		};
	}
}
