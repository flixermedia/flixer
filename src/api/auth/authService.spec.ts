import { scrypt } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { AuthService } from "./authService.js";
import { DEFAULT_LOGIN_SECURITY, setLoginSecurity } from "./login/loginSecurity.js";

vi.mock("node:crypto", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:crypto")>();
	return { ...original, scrypt: vi.fn(original.scrypt) };
});

describe("password authentication", () => {
	it.each(["login", "resendVerification"] as const)("performs scrypt for known and unknown users in %s", async (method) => {
		const findOneBy = vi.fn();
		const service = new AuthService({ getRepository: () => ({ findOneBy }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		const passwordHash = await service.hashPassword("correct-password");
		findOneBy.mockResolvedValueOnce({ id: "known", passwordHash }).mockResolvedValueOnce(null);
		vi.mocked(scrypt).mockClear();

		await expect(service[method]("known", "wrong-password")).rejects.toThrow("Invalid username or password.");
		await expect(service[method]("unknown", "wrong-password")).rejects.toThrow("Invalid username or password.");
		expect(scrypt).toHaveBeenCalledTimes(2);
		for (const call of vi.mocked(scrypt).mock.calls) {
			expect(call[0]).toBe("wrong-password");
			expect(call[1]).toHaveLength(16);
			expect(call[2]).toBe(64);
			expect(call[3]).toMatchObject({ N: 1 << 14 });
		}
	});

	it("does not authenticate an unknown user even if dummy verification succeeds", async () => {
		const service = new AuthService({ getRepository: () => ({ findOneBy: async () => null }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		const verifier = service as unknown as { verifyPassword: (password: string, hash: string) => Promise<boolean> };
		vi.spyOn(verifier, "verifyPassword").mockResolvedValue(true);
		await expect(service.login("unknown", "password")).rejects.toThrow("Invalid username or password.");
		expect(verifier.verifyPassword).toHaveBeenCalledOnce();
	});

	it("performs scrypt and rejects an account with a malformed password hash", async () => {
		const service = new AuthService({ getRepository: () => ({ findOneBy: async () => ({ passwordHash: "invalid" }) }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		vi.mocked(scrypt).mockClear();
		await expect(service.login("known", "wrong-password")).rejects.toMatchObject({ status: 401, message: "Invalid username or password." });
		expect(scrypt).toHaveBeenCalledOnce();
	});

	it("keeps known and unknown login failure latency distributions comparable", async () => {
		const findOneBy = vi.fn();
		const service = new AuthService({ getRepository: () => ({ findOneBy }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		const passwordHash = await service.hashPassword("correct-password");
		findOneBy.mockImplementation(async ({ username }: { username: string }) => (username === "known" ? { id: "known", passwordHash } : null));
		const samples: Record<"known" | "unknown", number[]> = { known: [], unknown: [] };
		for (let index = 0; index < 8; index++) {
			for (const username of index % 2 === 0 ? (["known", "unknown"] as const) : (["unknown", "known"] as const)) {
				const started = performance.now();
				await expect(service.login(username, "wrong-password")).rejects.toMatchObject({ status: 401, message: "Invalid username or password." });
				samples[username].push(performance.now() - started);
			}
		}
		for (const values of Object.values(samples)) {
			values.sort((first, second) => first - second);
			expect(values[0]).toBeGreaterThanOrEqual(395);
		}
		expect(Math.abs(samples.known[4] - samples.unknown[4])).toBeLessThan(150);
		expect(Math.abs(samples.known[7] - samples.unknown[7])).toBeLessThan(250);
	}, 30_000);

	it("throttles parallel attempts before password verification", async () => {
		const findOneBy = vi.fn().mockResolvedValue(null);
		const service = new AuthService({ getRepository: () => ({ findOneBy }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		const results = await Promise.allSettled(Array.from({ length: 11 }, (_, index) => service.login(index % 2 ? "Same-User" : "same-user", "wrong-password")));
		expect(findOneBy).toHaveBeenCalledTimes(10);
		expect(results.filter((result) => result.status === "rejected" && result.reason.status === 401)).toHaveLength(10);
		const limited = results.find((result) => result.status === "rejected" && result.reason.status === 429);
		expect(limited).toMatchObject({ status: "rejected", reason: { status: 429, headers: { "Retry-After": expect.any(String) } } });
	}, 15_000);

	it("continues to authenticate valid credentials", async () => {
		const findOneBy = vi.fn();
		const service = new AuthService({ getRepository: () => ({ findOneBy }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		const passwordHash = await service.hashPassword("correct-password");
		const user = { id: "known", passwordHash };
		findOneBy.mockResolvedValue(user);
		vi.spyOn(service, "completePrimaryAuthentication").mockResolvedValue({ passkeyRequired: true, ticket: "ticket" });
		expect(await service.login(" KNOWN ", "correct-password")).toEqual({ passkeyRequired: true, ticket: "ticket" });
		expect(findOneBy).toHaveBeenCalledWith({ username: "known" });
		expect(service.completePrimaryAuthentication).toHaveBeenCalledWith(user);
	});

	it("does not consume failure quotas for successful logins", async () => {
		const user = { id: "known", passwordHash: "hash" };
		const service = new AuthService({ getRepository: () => ({ findOneBy: async () => user }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		const verifier = service as unknown as { verifyPassword: (password: string, hash: string) => Promise<boolean> };
		vi.spyOn(verifier, "verifyPassword").mockResolvedValue(true);
		vi.spyOn(service, "completePrimaryAuthentication").mockResolvedValue({ passkeyRequired: true, ticket: "ticket" });
		for (let index = 0; index < 25; index++) {
			await expect(service.login("known", "correct-password")).resolves.toMatchObject({ passkeyRequired: true });
		}
	});

	it("can disable timing and throttling while still rejecting invalid credentials", async () => {
		const service = new AuthService({ getRepository: () => ({ findOneBy: async () => null }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		const verifier = service as unknown as { verifyPassword: (password: string, hash: string) => Promise<boolean> };
		vi.spyOn(verifier, "verifyPassword").mockResolvedValue(false);
		setLoginSecurity({ ...DEFAULT_LOGIN_SECURITY, timingEnabled: false, throttleEnabled: false });
		try {
			const results = await Promise.allSettled(Array.from({ length: 25 }, () => service.login("unknown", "wrong-password")));
			expect(results.every((result) => result.status === "rejected" && result.reason.status === 401)).toBe(true);
			expect(verifier.verifyPassword).toHaveBeenCalledTimes(25);
		} finally {
			setLoginSecurity(DEFAULT_LOGIN_SECURITY);
		}
	});

	it("applies changed throttle settings to the running service", async () => {
		const service = new AuthService({ getRepository: () => ({ findOneBy: async () => null }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
		const verifier = service as unknown as { verifyPassword: (password: string, hash: string) => Promise<boolean> };
		vi.spyOn(verifier, "verifyPassword").mockResolvedValue(false);
		const settings = { ...DEFAULT_LOGIN_SECURITY, timingEnabled: false, ipLimit: 2, usernameLimit: 2 };
		setLoginSecurity(settings);
		try {
			await expect(service.login("unknown", "wrong-password")).rejects.toMatchObject({ status: 401 });
			await expect(service.login("unknown", "wrong-password")).rejects.toMatchObject({ status: 401 });
			await expect(service.login("unknown", "wrong-password")).rejects.toMatchObject({ status: 429 });
			setLoginSecurity({ ...settings, throttleEnabled: false });
			await expect(service.login("unknown", "wrong-password")).rejects.toMatchObject({ status: 401 });
			setLoginSecurity(settings);
			await expect(service.login("unknown", "wrong-password")).rejects.toMatchObject({ status: 401 });
		} finally {
			setLoginSecurity(DEFAULT_LOGIN_SECURITY);
		}
	});
});
