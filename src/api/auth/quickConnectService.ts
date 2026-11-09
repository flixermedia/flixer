import { BadRequest, Forbidden, NotFound, TooManyRequests, Unauthorized } from "@tsed/exceptions";
import { getContext, Inject, Injectable } from "@tsed/di";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DataSource, EntityManager, LessThan, MoreThan } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { QuickConnectRequest, type QuickConnectStatus } from "../../entities/quickConnectRequest.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import { AuthService, type AuthResult } from "./authService.js";

const QUICK_CONNECT_SETTING = "quick_connect_enabled";
const REQUEST_LIFETIME_MS = 5 * 60_000;
const RATE_WINDOW_MS = 10 * 60_000;
const MAX_STARTS_PER_WINDOW = 5;
const MAX_DECISIONS_PER_WINDOW = 20;
const USER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

interface RequestContextLike {
	request?: { get(name: string): unknown; raw?: { ip?: string } };
}

interface RateWindow {
	count: number;
	resetAt: number;
}

export type QuickConnectPollResult = { status: "pending" | "denied" | "expired" } | { status: "approved"; auth: AuthResult };

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function getClientAddress(): string {

	const request = getContext<RequestContextLike>()?.request;
	const forwardedAddress = request?.get("x-real-ip");
	const address = (typeof forwardedAddress === "string" && forwardedAddress.trim()) || request?.raw?.ip;
	return typeof address === "string" && address ? address.slice(0, 64) : "unknown";

}

@Injectable()
export class QuickConnectService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
	) {}

	private readonly rateWindows = new Map<string, RateWindow>();

	async getStatus(): Promise<{ enabled: boolean }> {
		return { enabled: await this.isEnabled() };
	}

	async start(): Promise<{ requestId: string; userCode: string; pollToken: string; expiresAt: Date }> {
		await this.requireEnabled();
		this.assertRateLimit("start", MAX_STARTS_PER_WINDOW);

		const repository = this.dataSource.getRepository(QuickConnectRequest);
		const now = new Date();
		await repository.delete({ expiresAt: LessThan(now) });

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const userCode = this.createUserCode();
			const pollToken = randomBytes(32).toString("base64url");
			const expiresAt = new Date(Date.now() + REQUEST_LIFETIME_MS);

			try {
				const request = await repository.save(
					repository.create({
						id: randomUUID(),
						userCodeHash: hash(`quick-connect-code:${userCode}`),
						pollTokenHash: hash(`quick-connect-poll:${pollToken}`),
						status: "pending",
						userId: null,
						expiresAt,
					}),
				);
				return {
					requestId: request.id,
					userCode,
					pollToken,
					expiresAt,
				};
			} catch (error) {
				if (attempt === 2 || !this.isUniqueViolation(error)) throw error;
			}
		}

		throw new Error("Unable to create a unique Quick Connect code.");
	}

	async approve(authorization: string | undefined, userCode: string): Promise<{ approved: true; expiresAt: Date }> {
		const { user } = await this.authService.requireAuthenticatedSession(authorization);
		const expiresAt = await this.decide(user, userCode, "approved");
		return { approved: true, expiresAt };
	}

	async deny(authorization: string | undefined, userCode: string): Promise<{ denied: true }> {
		const { user } = await this.authService.requireAuthenticatedSession(authorization);
		await this.decide(user, userCode, "denied");
		return { denied: true };
	}

	async poll(requestId: string, pollToken: string): Promise<QuickConnectPollResult> {
		await this.requireEnabled();
		if (!AuthService.isUuid(requestId)) throw new BadRequest("The Quick Connect request ID is invalid.");

		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(QuickConnectRequest);
			const request = await repository.findOne({
				where: {
					id: requestId.toLowerCase(),
					pollTokenHash: hash(`quick-connect-poll:${pollToken}`),
				},
				lock: { mode: "pessimistic_write" },
			});
			if (!request) throw new Unauthorized("This Quick Connect request is invalid or has expired.");
			if (request.expiresAt <= new Date()) {
				await repository.remove(request);
				return { status: "expired" };
			}
			if (request.status === "pending") return { status: "pending" };
			if (request.status === "denied") {
				await repository.remove(request);
				return { status: "denied" };
			}

			const user = request.userId ? await manager.getRepository(User).findOneBy({ id: request.userId }) : null;
			if (!user || user.disabledAt) {
				await repository.remove(request);
				return { status: "expired" };
			}

			const auth = await this.authService.issueAuthResult(user, manager);
			await repository.remove(request);
			return { status: "approved", auth };
		});
	}

	private async decide(user: User, submittedCode: string, status: Extract<QuickConnectStatus, "approved" | "denied">): Promise<Date> {
		await this.requireEnabled();
		this.assertRateLimit("decision", MAX_DECISIONS_PER_WINDOW);

		const userCode = submittedCode.replaceAll("-", "").toUpperCase();
		if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(userCode)) {
			throw new BadRequest("Enter a valid Quick Connect code.");
		}

		const now = new Date();
		const request = await this.dataSource.getRepository(QuickConnectRequest).findOneBy({
			userCodeHash: hash(`quick-connect-code:${userCode}`),
			status: "pending",
			expiresAt: MoreThan(now),
		});
		if (!request) throw new NotFound("This Quick Connect code is invalid, expired, or already used.");

		const result = await this.dataSource.getRepository(QuickConnectRequest).update({ id: request.id, status: "pending", expiresAt: MoreThan(now) }, { status, userId: status === "approved" ? user.id : null });
		if (result.affected !== 1) {
			throw new NotFound("This Quick Connect code is invalid, expired, or already used.");
		}

		return request.expiresAt;
	}

	private async requireEnabled(): Promise<void> {
		if (!(await this.isEnabled())) throw new Forbidden("Quick Connect is disabled by the server administrator.");
	}

	private async isEnabled(): Promise<boolean> {
		const setting = await this.dataSource.getRepository(Setting).findOneBy({ key: QUICK_CONNECT_SETTING });
		return setting?.value === true;
	}

	private createUserCode(): string {
		const bytes = randomBytes(8);
		return [...bytes].map((byte) => USER_CODE_ALPHABET[byte & 31]).join("");
	}

	private assertRateLimit(action: string, limit: number): void {
		const now = Date.now();
		const key = `${action}:${getClientAddress()}`;
		const window = this.rateWindows.get(key);
		if (!window || window.resetAt <= now) {
			this.rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
			if (this.rateWindows.size > 1000) {
				for (const [entry, value] of this.rateWindows) {
					if (value.resetAt <= now) this.rateWindows.delete(entry);
				}
			}
			return;
		}
		if (window.count >= limit) throw new TooManyRequests("Quick Connect is temporarily rate limited. Try again later.");
		window.count += 1;
	}

	private isUniqueViolation(error: unknown): boolean {
		if (typeof error !== "object" || error === null || !("driverError" in error)) return false;
		const driverError = error.driverError;
		return typeof driverError === "object" && driverError !== null && "code" in driverError && driverError.code === "23505";
	}
}
