import { Env } from "@tsed/core";
import { Controller } from "@tsed/di";
import type { BaseContext } from "@tsed/di";
import { TooManyRequests, Unauthorized } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { BodyParams } from "@tsed/platform-params";
import { Post } from "@tsed/schema";
import type { FastifyInstance } from "fastify";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../authService.ts";
import { LoginExceptionFilter } from "./loginExceptionFilter.ts";
import { LoginRequest } from "./loginRequest.ts";

let timingService: AuthService | undefined;

@Controller("/auth")
class TestAuthController {
	@Post("/login")
	login(@BodyParams() request: LoginRequest) {
		if (!timingService) throw new Unauthorized("Invalid username or password.");
		return timingService.login(request.username, request.password);
	}
}

describe("LoginExceptionFilter", () => {
	it.each([Env.DEV, Env.PROD])("omits stack traces and details from login failures in %s", (env) => {
		const response = { setHeaders: vi.fn(), contentType: vi.fn(), status: vi.fn(), body: vi.fn() };
		response.setHeaders.mockReturnValue(response);
		response.contentType.mockReturnValue(response);
		response.status.mockReturnValue(response);
		const ctx = { env, request: { url: "/api/auth/login?source=test" }, response } as unknown as BaseContext;
		const error = new Unauthorized("Invalid username or password.");
		Object.assign(error, { errors: [{ secret: "private" }] });
		new LoginExceptionFilter().catch(error, ctx);
		expect(response.status).toHaveBeenCalledWith(401);
		expect(response.body).toHaveBeenCalledWith({ name: error.name, message: "Invalid username or password.", status: 401 });
		expect(JSON.stringify(response.body.mock.calls)).not.toContain("private");
		expect(JSON.stringify(response.body.mock.calls)).not.toContain("stack");
	});

	it("preserves Retry-After for throttled logins", () => {
		const response = { setHeaders: vi.fn(), contentType: vi.fn(), status: vi.fn(), body: vi.fn() };
		response.setHeaders.mockReturnValue(response);
		response.contentType.mockReturnValue(response);
		response.status.mockReturnValue(response);
		const error = new TooManyRequests("Too many sign-in attempts. Try again later.");
		error.setHeader("Retry-After", "60");
		new LoginExceptionFilter().catch(error, { request: { url: "/api/auth/login" }, response } as unknown as BaseContext);
		expect(response.setHeaders).toHaveBeenCalledWith({ "Retry-After": "60" });
		expect(response.status).toHaveBeenCalledWith(429);
	});

	it("sanitizes login errors and compares failure latency through the Fastify pipeline", async () => {
		const platform = await PlatformFastify.bootstrap({ mount: { "/api": [TestAuthController] }, env: Env.DEV, httpPort: false, httpsPort: false, logger: { disableBootstrapLog: true, logRequest: false } });
		try {
			await platform.listen(false);
			const server = platform.app.getApp() as FastifyInstance;
			const response = await server.inject({ method: "POST", url: "/api/auth/login" });
			expect(response.statusCode).toBe(401);
			expect(response.json()).toMatchObject({ message: "Invalid username or password.", status: 401 });
			expect(response.json()).not.toHaveProperty("stack");
			expect(response.json()).not.toHaveProperty("errors");

			const { AuthService } = await import("../authService.ts");
			const findOneBy = vi.fn();
			timingService = new AuthService({ getRepository: () => ({ findOneBy }) } as unknown as DataSource, {} as never, {} as never, {} as never, {} as never);
			const passwordHash = await timingService.hashPassword("correct-password");
			findOneBy.mockImplementation(async ({ username }: { username: string }) => (username === "known" ? { id: "known", passwordHash } : null));
			const samples: Record<"known" | "unknown", number[]> = { known: [], unknown: [] };
			let failureBody: unknown;
			for (let index = 0; index < 6; index++) {
				for (const username of index % 2 === 0 ? (["known", "unknown"] as const) : (["unknown", "known"] as const)) {
					const started = performance.now();
					const response = await server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "wrong-password" } });
					samples[username].push(performance.now() - started);
					expect(response.statusCode).toBe(401);
					expect(response.json()).toMatchObject({ message: "Invalid username or password.", status: 401 });
					expect(response.json()).not.toHaveProperty("stack");
					failureBody ??= response.json();
					expect(response.json()).toEqual(failureBody);
				}
			}
			for (const values of Object.values(samples)) {
				values.sort((first, second) => first - second);
				expect(values[0]).toBeGreaterThanOrEqual(395);
			}
			expect(Math.abs(samples.known[3] - samples.unknown[3])).toBeLessThan(150);
			expect(Math.abs(samples.known[5] - samples.unknown[5])).toBeLessThan(250);
			const additional = await Promise.all(Array.from({ length: 4 }, () => server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "known", password: "wrong-password" } })));
			for (const attempt of additional) expect(attempt.statusCode).toBe(401);
			const limited = await server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "KNOWN", password: "wrong-password" } });
			expect(limited.statusCode).toBe(429);
			expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
			expect(limited.json()).not.toHaveProperty("stack");
		} finally {
			timingService = undefined;
			await platform.stop();
		}
	}, 20_000);
});
