import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRUSTED_PROXIES, isTrustedProxy, setTrustedProxyConfig } from "../../config/trustedProxies.js";
import { RateLimitService } from "./rateLimitService.js";

const state = vi.hoisted(() => ({ context: undefined as { request: { raw: { ip: string } } } | undefined }));

vi.mock("@tsed/di", async (importOriginal) => ({
	...await importOriginal<typeof import("@tsed/di")>(),
	getContext: () => state.context,
}));

describe("RateLimitService", () => {
	afterEach(() => {
		state.context = undefined;
		setTrustedProxyConfig(DEFAULT_TRUSTED_PROXIES);
		vi.useRealTimers();
	});

	it("resets a client's window and keeps policies independent", async () => {
		vi.useFakeTimers();
		const limiter = new RateLimitService();
		state.context = { request: { raw: { ip: "192.0.2.1" } } };
		for (let attempt = 0; attempt < 5; attempt++) await limiter.consume("quickConnectStart", "limited");
		await expect(limiter.consume("quickConnectStart", "limited")).rejects.toThrow("limited");
		await expect(limiter.consume("quickConnectDecision", "limited")).resolves.toBeUndefined();
		await vi.advanceTimersByTimeAsync(600_000);
		await expect(limiter.consume("quickConnectStart", "limited")).resolves.toBeUndefined();
	});

	it("uses Fastify's trusted proxy address and ignores forged forwarding headers", async () => {
		setTrustedProxyConfig({ enabled: true, addresses: ["192.0.2.10"] });
		const server = Fastify({ trustProxy: isTrustedProxy });
		const limiter = new RateLimitService();
		server.get("/", async (request, reply) => {
			state.context = { request: { raw: request } };
			try {
				await limiter.consume("quickConnectStart", "limited");
				return reply.code(200).send();
			} catch {
				return reply.code(429).send();
			}
		});
		try {
			for (let attempt = 0; attempt < 5; attempt++) {
				const response = await server.inject({ url: "/", remoteAddress: "192.0.2.20", headers: { "x-real-ip": `198.51.100.${attempt}`, "x-forwarded-for": `198.51.100.${attempt}` } });
				expect(response.statusCode).toBe(200);
			}
			expect((await server.inject({ url: "/", remoteAddress: "192.0.2.20", headers: { "x-real-ip": "198.51.100.10", "x-forwarded-for": "198.51.100.10" } })).statusCode).toBe(429);
			const requestFor = (client: string) => server.inject({ url: "/", remoteAddress: "192.0.2.10", headers: { "x-forwarded-for": client } });
			for (let attempt = 0; attempt < 5; attempt++) expect((await requestFor("198.51.100.1")).statusCode).toBe(200);
			expect((await requestFor("198.51.100.1")).statusCode).toBe(429);
			expect((await requestFor("198.51.100.2")).statusCode).toBe(200);
		} finally {
			await server.close();
		}
	});
});