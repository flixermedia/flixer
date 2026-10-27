import { createHash } from "node:crypto";
import { Unauthorized } from "@tsed/exceptions";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { User } from "../../entities/user.entity.js";
import { AuthService } from "./authService.js";
import { PasskeyService } from "./passkeyService.js";

describe("PasskeyService native handoff exchange", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("exchanges a matching PKCE-bound code once", async () => {
		const user = { id: "00000000-0000-4000-8000-000000000001" };
		const authResult = { accessToken: "access-token" };
		const { service, execute, issueAuthResult, where } = createService(
			[{ raw: [{ user_id: user.id }] }, { raw: [] }],
			user,
			authResult,
		);
		const request = {
			code: "c".repeat(43),
			codeVerifier: "v".repeat(43),
			state: "s".repeat(32),
		};

		await expect(service.exchangeNativeHandoff(request.code, request.codeVerifier, request.state)).resolves.toBe(
			authResult,
		);
		await expect(
			service.exchangeNativeHandoff(request.code, request.codeVerifier, request.state),
		).rejects.toBeInstanceOf(Unauthorized);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(issueAuthResult).toHaveBeenCalledOnce();
		expect(where).toHaveBeenCalledWith(
			"code_hash = :codeHash AND code_challenge = :codeChallenge AND state = :state AND expires_at > now()",
			{
				codeHash: createHash("sha256").update(request.code).digest("hex"),
				codeChallenge: createHash("sha256").update(request.codeVerifier).digest("base64url"),
				state: request.state,
			},
		);
	});

	it("rejects state or verifier mismatches without issuing a token", async () => {
		const { service, issueAuthResult, where } = createService([{ raw: [] }, { raw: [] }]);
		const code = "c".repeat(43);
		const verifier = "v".repeat(43);

		await expect(service.exchangeNativeHandoff(code, verifier, "x".repeat(32))).rejects.toBeInstanceOf(
			Unauthorized,
		);
		await expect(service.exchangeNativeHandoff(code, "w".repeat(43), "s".repeat(32))).rejects.toBeInstanceOf(
			Unauthorized,
		);

		expect(where).toHaveBeenNthCalledWith(
			1,
			expect.any(String),
			expect.objectContaining({
				state: "x".repeat(32),
				codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
			}),
		);
		expect(where).toHaveBeenNthCalledWith(
			2,
			expect.any(String),
			expect.objectContaining({
				state: "s".repeat(32),
				codeChallenge: createHash("sha256").update("w".repeat(43)).digest("base64url"),
			}),
		);
		expect(issueAuthResult).not.toHaveBeenCalled();
	});

	it("rejects malformed exchange values before querying storage", async () => {
		const { service, execute } = createService([]);

		await expect(service.exchangeNativeHandoff("short", "v".repeat(43), "s".repeat(32))).rejects.toBeInstanceOf(
			Unauthorized,
		);

		expect(execute).not.toHaveBeenCalled();
	});
});

function createService(
	results: Array<{ raw: Array<{ user_id: string }> }>,
	user = { id: "00000000-0000-4000-8000-000000000001" },
	authResult: object = { accessToken: "access-token" },
) {

	const where = vi.fn();
	const execute = vi.fn(async () => results.shift() ?? { raw: [] });
	const builder = {
		delete: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn((...args: unknown[]) => {
			where(...args);
			return builder;
		}),
		returning: vi.fn().mockReturnThis(),
		execute,
	};
	const userRepository = { findOneBy: vi.fn().mockResolvedValue(user) };
	const dataSource = {
		createQueryBuilder: vi.fn(() => builder),
		getRepository: vi.fn((entity: unknown) => (entity === User ? userRepository : undefined)),
	};
	const issueAuthResult = vi.fn().mockResolvedValue(authResult);
	const authService = { issueAuthResult };
	const service = new PasskeyService(dataSource as unknown as DataSource, authService as unknown as AuthService);

	return { service, execute, issueAuthResult, where };

}
