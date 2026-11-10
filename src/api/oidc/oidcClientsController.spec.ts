import "reflect-metadata";
import "@tsed/ajv";
import { Configuration } from "@tsed/di";
import { Forbidden } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";
import { OidcClientsController } from "./oidcClientsController.js";
import { OidcClientService } from "./oidcClientService.js";
import { OidcProviderService } from "./oidcProviderService.js";

@Configuration({})
class TestServer {}

describe("OAuth admin configuration", () => {
	const auth = {
		requireAdminSession: vi.fn(async (header?: string) => {
			if (header !== "Bearer admin-test") throw new Forbidden("Administrator access is required.");
		}),
	};
	const provider = {
		getConfiguration: vi.fn(async () => ({ publicUrl: "", issuer: "" })),
		setPublicUrl: vi.fn(async (publicUrl: string) => ({ publicUrl, issuer: `${publicUrl}/api/oidc` })),
	};
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false, httpsPort: false,
			mount: { "/api": [OidcClientsController] },
			imports: [
				{ token: DefaultDataSource, use: {} },
				{ token: AuthService, use: auth },
				{ token: OidcClientService, use: {} },
				{ token: OidcProviderService, use: provider },
			],
		});
		await platform.listen(false);
	});

	afterAll(async () => {
		await platform?.stop();
	});

	it("allows only administrators to read and update the OAuth public URL", async () => {
		const app = platform.adapter.app.getApp();
		const url = "/api/admin/oidc/clients/configuration";
		expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);
		expect((await app.inject({ method: "PUT", url, payload: { publicUrl: "https://flixer.example" } })).statusCode).toBe(403);
		expect(provider.setPublicUrl).not.toHaveBeenCalled();
		const headers = { authorization: "Bearer admin-test" };
		const read = await app.inject({ method: "GET", url, headers });
		expect(read.json()).toEqual({ publicUrl: "", issuer: "" });
		const saved = await app.inject({ method: "PUT", url, headers, payload: { publicUrl: "https://flixer.example" } });
		expect(saved.statusCode).toBe(200);
		expect(saved.json()).toEqual({ publicUrl: "https://flixer.example", issuer: "https://flixer.example/api/oidc" });
		expect(provider.setPublicUrl).toHaveBeenCalledWith("https://flixer.example");
	});
});
