import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TRUSTED_PROXIES, isTrustedProxy, setTrustedProxyConfig, validateTrustedProxyConfig } from "./trustedProxies.js";

describe("trusted proxies", () => {
	afterEach(() => setTrustedProxyConfig(DEFAULT_TRUSTED_PROXIES));

	it("applies and disables trusted addresses without restarting Fastify", async () => {
		const server = Fastify({ trustProxy: isTrustedProxy });
		server.get("/", (request) => ({ ip: request.ip }));
		const request = () => server.inject({ url: "/", remoteAddress: "192.0.2.10", headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.1" } });
		expect((await request()).json()).toEqual({ ip: "192.0.2.10" });
		setTrustedProxyConfig({ enabled: true, addresses: ["192.0.2.0/24"] });
		expect((await request()).json()).toEqual({ ip: "203.0.113.1" });
		setTrustedProxyConfig({ enabled: false, addresses: ["192.0.2.0/24"] });
		expect((await request()).json()).toEqual({ ip: "192.0.2.10" });
		await server.close();
	});

	it("rejects malformed proxy settings and handles mapped IPv4 addresses", () => {
		expect(() => validateTrustedProxyConfig({ enabled: true, addresses: ["*"] })).toThrow();
		expect(() => validateTrustedProxyConfig({ enabled: true, addresses: [] })).toThrow();
		expect(() => validateTrustedProxyConfig({ enabled: true, addresses: ["192.0.2.0/99"] })).toThrow();
		setTrustedProxyConfig({ enabled: true, addresses: ["192.0.2.0/24"] });
		expect(isTrustedProxy("::ffff:192.0.2.10")).toBe(true);
		expect(isTrustedProxy("::ffff:203.0.113.10")).toBe(false);
	});
	it("ignores forwarded addresses by default and from untrusted peers", async () => {
		for (const configured of [DEFAULT_TRUSTED_PROXIES, { enabled: true, addresses: ["192.0.2.10"] }]) {
			setTrustedProxyConfig(configured);
			const server = Fastify({ trustProxy: isTrustedProxy });
			server.get("/", (request) => ({ ip: request.ip }));
			const response = await server.inject({ url: "/", remoteAddress: "192.0.2.20", headers: { "x-forwarded-for": "203.0.113.1" } });
			expect(response.json()).toEqual({ ip: "192.0.2.20" });
			await server.close();
		}
	});

	it("uses the client address from an explicitly trusted proxy without trusting earlier spoofed entries", async () => {
		setTrustedProxyConfig({ enabled: true, addresses: ["192.0.2.10", "127.0.0.1"] });
		const server = Fastify({ trustProxy: isTrustedProxy });
		server.get("/", (request) => ({ ip: request.ip }));
		const response = await server.inject({ url: "/", remoteAddress: "192.0.2.10", headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.1" } });
		expect(response.json()).toEqual({ ip: "203.0.113.1" });
		await server.close();
	});
});