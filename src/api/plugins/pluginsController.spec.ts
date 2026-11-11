import "reflect-metadata";
import "@tsed/platform-multer";
import { Configuration } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";
import { ExternalOAuthProfilesService } from "../auth/externalOAuthProfilesService.js";
import { PluginManagerService } from "./pluginManagerService.js";
import { PluginSettingsService } from "./pluginSettingsService.js";
import { PluginsController } from "./pluginsController.js";

@Configuration({})
class TestServer {}

describe("local plugin import routes", () => {
	const manifest = { id: "example.github-oauth", name: "GitHub OAuth", version: "0.1.0", permissions: ["auth.identity.verify"] };
	const auth = {
		requireAdminSession: vi.fn(async (header?: string) => {
			if (header !== "Bearer admin") throw new Unauthorized("Admin required");
			return { user: { id: "admin" } };
		}),
		requireAdmin: vi.fn(async () => ({ id: "admin" })),
	};
	const plugins = {
		$onReady: vi.fn(),
		$onDestroy: vi.fn(),
		localImportEnabled: vi.fn(() => true),
		inspectLocalPackage: vi.fn().mockResolvedValue(manifest),
		importLocalPackage: vi.fn().mockResolvedValue({ pluginId: manifest.id, enabled: false }),
		repositoryImage: vi.fn().mockResolvedValue({ data: Buffer.from("image"), mime: "image/png" }),
	};
	const oauthProfiles = { list: vi.fn().mockResolvedValue([]), save: vi.fn().mockResolvedValue({ id: "profile" }) };
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false,
			httpsPort: false,
			mount: { "/api": [PluginsController] },
			imports: [
				{ token: DefaultDataSource, use: {} },
				{ token: AuthService, use: auth },
				{ token: PluginManagerService, use: plugins },
				{ token: PluginSettingsService, use: {} },
				{ token: ExternalOAuthProfilesService, use: oauthProfiles },
			],
		});
		await platform.listen(false);
	});

	afterAll(async () => {
		await platform?.stop();
	});

	it("rejects unauthenticated malformed uploads before multipart parsing", async () => {
		plugins.inspectLocalPackage.mockClear();
		const response = await platform.adapter.app.getApp().inject({
			method: "POST",
			url: "/api/admin/plugins/local-import/preview",
			headers: { "content-type": "multipart/form-data; boundary=broken" },
			payload: "not multipart",
		});
		expect(response.statusCode).toBe(401);
		expect(plugins.inspectLocalPackage).not.toHaveBeenCalled();
	});

	it("only allows administrators to manage OAuth profiles", async () => {
		const app = platform.adapter.app.getApp();
		oauthProfiles.list.mockClear();
		const denied = await app.inject({ method: "GET", url: "/api/admin/plugins/example.oauth/oauth-providers" });
		expect(denied.statusCode).toBe(401);
		expect(oauthProfiles.list).not.toHaveBeenCalled();
		const allowed = await app.inject({ method: "GET", url: "/api/admin/plugins/example.oauth/oauth-providers", headers: { authorization: "Bearer admin" } });
		expect(allowed.statusCode).toBe(200);
		expect(oauthProfiles.list).toHaveBeenCalledWith("example.oauth");
	});

	it("requires an administrator session to load catalog images", async () => {
		const app = platform.adapter.app.getApp();
		plugins.repositoryImage.mockClear();
		const path = "/api/admin/plugins/repositories/repository-id/image?path=images%2Flogo.png";
		const denied = await app.inject({ method: "GET", url: path });
		expect(denied.statusCode).toBe(401);
		expect(plugins.repositoryImage).not.toHaveBeenCalled();
		const allowed = await app.inject({ method: "GET", url: path, headers: { authorization: "Bearer admin" } });
		expect(allowed.statusCode).toBe(200);
		expect(allowed.headers["content-type"]).toBe("image/png");
		expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
		expect(plugins.repositoryImage).toHaveBeenCalledWith("repository-id", "images/logo.png");
	});

	it("previews an authorized package and imports only the submitted approvals", async () => {
		const boundary = "plugin-boundary";
		const archive = Buffer.from("test archive");
		const filePart = Buffer.concat([
			Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="package"; filename="plugin.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n`),
			archive,
			Buffer.from(`\r\n--${boundary}--\r\n`),
		]);
		const headers = { "content-type": `multipart/form-data; boundary=${boundary}`, authorization: "Bearer admin" };
		const preview = await platform.adapter.app.getApp().inject({ method: "POST", url: "/api/admin/plugins/local-import/preview", headers, payload: filePart });
		expect(preview.statusCode).toBe(200);
		expect(JSON.parse(preview.body)).toEqual({ manifest });
		expect(plugins.inspectLocalPackage).toHaveBeenCalledWith(archive);

		const importBoundary = "plugin-import";
		const upload = Buffer.concat([
			Buffer.from(`--${importBoundary}\r\nContent-Disposition: form-data; name="package"; filename="plugin.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n`),
			archive,
			Buffer.from(`\r\n--${importBoundary}\r\nContent-Disposition: form-data; name="approvedPermissions"\r\n\r\n["auth.identity.verify"]\r\n--${importBoundary}--\r\n`),
		]);
		const imported = await platform.adapter.app.getApp().inject({
			method: "POST", url: "/api/admin/plugins/local-import",
			headers: { ...headers, "content-type": `multipart/form-data; boundary=${importBoundary}` }, payload: upload,
		});
		expect(imported.statusCode).toBe(200);
		expect(plugins.importLocalPackage).toHaveBeenCalledWith(archive, ["auth.identity.verify"]);
	});
});