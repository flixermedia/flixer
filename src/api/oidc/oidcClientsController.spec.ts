import "reflect-metadata";
import "@tsed/ajv";
import { Configuration } from "@tsed/di";
import { Forbidden } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaAccessService } from "../access/mediaAccessService.js";
import { AuthService } from "../auth/authService.js";
import { EntitlementService } from "../payments/entitlementService.js";
import { OidcClientsController } from "./oidcClientsController.js";
import { OidcClientService } from "./oidcClientService.js";
import { OidcProviderService } from "./oidcProviderService.js";
import { OidcResourceController } from "./oidcResourceController.js";

@Configuration({})
class TestServer {}

describe("OAuth admin configuration", () => {
	const adminHeader = "Bearer admin-test";
	const headers = { authorization: adminHeader };
	const auth = {
		requireAdminSession: vi.fn(async (header?: string) => {
			if (header !== adminHeader) throw new Forbidden("Administrator access is required.");
		}),
	};
	const provider = {
		getConfiguration: vi.fn(async () => ({ publicUrl: "", issuer: "" })),
		setPublicUrl: vi.fn(async (publicUrl: string) => ({ publicUrl, issuer: `${publicUrl}/api/oidc` })),
	};
	const clients = { setResourceScopes: vi.fn(async () => {}) };
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false, httpsPort: false,
			mount: { "/api": [OidcClientsController, OidcResourceController] },
			imports: [
				{ token: DefaultDataSource, use: {} },
				{ token: AuthService, use: auth },
				{ token: OidcClientService, use: clients },
				{ token: OidcProviderService, use: provider },
				{ token: MediaAccessService, use: {} },
				{ token: EntitlementService, use: {} },
			],
		});
		await platform.listen(false);
	});

	afterAll(async () => {
		await platform?.stop();
	});

	it("allows only administrators to configure resource permissions", async () => {
		const app = platform.adapter.app.getApp();
		const url = "/api/admin/oidc/clients/client-id/resource-scopes";
		expect((await app.inject({ method: "PUT", url, payload: { scopes: ["subscriptions:read"] } })).statusCode).toBe(403);
		expect(clients.setResourceScopes).not.toHaveBeenCalled();
		expect((await app.inject({ method: "PUT", url, headers, payload: {} })).statusCode).toBe(400);
		expect((await app.inject({ method: "PUT", url, headers, payload: { scopes: [] } })).statusCode).toBe(200);
		expect(clients.setResourceScopes).toHaveBeenCalledWith("client-id", []);
	});

	it("mounts the resource controller and rejects requests without an OAuth token", async () => {
		const response = await platform.adapter.app.getApp().inject({ method: "GET", url: "/api/oauth/me/subscriptions" });
		expect(response.statusCode).toBe(401);
		expect(response.headers["cache-control"]).toContain("no-store");
	});

	it("allows only administrators to read and update the OAuth public URL", async () => {
		const app = platform.adapter.app.getApp();
		const url = "/api/admin/oidc/clients/configuration";
		expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);
		expect((await app.inject({ method: "PUT", url, payload: { publicUrl: "https://flixer.example" } })).statusCode).toBe(403);
		expect(provider.setPublicUrl).not.toHaveBeenCalled();
		const read = await app.inject({ method: "GET", url, headers });
		expect(read.json()).toEqual({ publicUrl: "", issuer: "" });
		const saved = await app.inject({ method: "PUT", url, headers, payload: { publicUrl: "https://flixer.example" } });
		expect(saved.statusCode).toBe(200);
		expect(saved.json()).toEqual({ publicUrl: "https://flixer.example", issuer: "https://flixer.example/api/oidc" });
		expect(provider.setPublicUrl).toHaveBeenCalledWith("https://flixer.example");
	});
});
