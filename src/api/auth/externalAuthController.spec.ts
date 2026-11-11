import { describe, expect, it } from "vitest";
import type { PlatformContext } from "@tsed/platform-http";
import type { ExternalAuthService } from "./externalAuthService.js";
import { ExternalAuthController } from "./externalAuthController.js";
import type { ExternalOAuthService } from "./externalOAuthService.js";

describe("ExternalAuthController rate limiting", () => {
	it("does not let a forged forwarding header reset the client limit", () => {
		const controller = new ExternalAuthController({ login: () => undefined } as unknown as ExternalAuthService, {} as ExternalOAuthService);
		for (let attempt = 0; attempt < 10; attempt++) {
			const context = { request: { raw: { ip: "192.0.2.1" }, get: () => `198.51.100.${attempt}` } } as unknown as PlatformContext;
			expect(() => controller.login("plugin.example", { username: "name", password: "password" }, context)).not.toThrow();
		}
		const context = { request: { raw: { ip: "192.0.2.1" }, get: () => "198.51.100.11" } } as unknown as PlatformContext;
		expect(() => controller.login("plugin.example", { username: "name", password: "password" }, context)).toThrow("Too many sign-in attempts");
	});
});