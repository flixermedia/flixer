import { Inject, Injectable } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { ApiKey } from "../../entities/apiKey.entity.js";
import { User } from "../../entities/user.entity.js";

export const API_KEY_PREFIX = "flx_";
const DISPLAY_PREFIX_LENGTH = 12;
const LAST_USED_GRANULARITY_MS = 60_000;

export interface PublicApiKey {
	id: string;
	name: string;
	prefix: string;
	owner: { id: string; username: string; displayName: string };
	createdAt: Date;
	lastUsedAt: Date | null;
}

export interface CreatedApiKey extends PublicApiKey {
	/** The full key. Only returned when it is created. */
	secret: string;
}

function hashKey(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

/** Long-lived keys that let integrations call admin endpoints without a login session. */
@Injectable()
export class ApiKeyService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	isApiKey(token: string): boolean {
		return token.startsWith(API_KEY_PREFIX);
	}

	/** Returns the key's owner when the key is valid, and records that it was used. */
	async authenticate(secret: string): Promise<User> {
		const repository = this.dataSource.getRepository(ApiKey);
		const key = await repository.findOne({ where: { keyHash: hashKey(secret) }, relations: { user: true } });

		if (!key?.user) {
			throw new Unauthorized("Invalid API key.");
		}
		if (key.user.disabledAt) {
			throw new Unauthorized("The owner of this API key has been disabled.");
		}

		if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
			await repository.update({ id: key.id }, { lastUsedAt: new Date() });
		}

		return key.user;
	}

	async list(): Promise<PublicApiKey[]> {
		const keys = await this.dataSource.getRepository(ApiKey).find({ relations: { user: true }, order: { createdAt: "DESC" } });
		return keys.map((key) => this.toPublic(key));
	}

	async create(owner: User, name: string): Promise<CreatedApiKey> {
		const secret = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
		const repository = this.dataSource.getRepository(ApiKey);
		const saved = await repository.save(
			repository.create({
				id: randomUUID(),
				userId: owner.id,
				name: name.trim(),
				prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
				keyHash: hashKey(secret),
				lastUsedAt: null,
			}),
		);
		saved.user = owner;

		return { ...this.toPublic(saved), secret };
	}

	async revoke(id: string): Promise<boolean> {
		const result = await this.dataSource.getRepository(ApiKey).delete({ id });
		return (result.affected ?? 0) > 0;
	}

	private toPublic(key: ApiKey): PublicApiKey {
		return {
			id: key.id,
			name: key.name,
			prefix: key.prefix,
			owner: {
				id: key.userId,
				username: key.user?.username ?? "",
				displayName: key.user?.displayName ?? key.user?.username ?? "",
			},
			createdAt: key.createdAt,
			lastUsedAt: key.lastUsedAt,
		};
	}
}
