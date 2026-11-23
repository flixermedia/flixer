import "reflect-metadata";
import { Configuration } from "@tsed/di";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";
import { PaymentsService } from "../payments/paymentsService.js";
import { InvitesAdminController } from "./invitesAdminController.js";
import { InvitesService } from "./invitesService.js";

@Configuration({})
class TestServer {}

describe("InvitesAdminController routes", () => {
	const auth = {
		requireAdmin: vi.fn().mockResolvedValue({ id: "admin", role: "admin" }),
		getUserFromKeyOrSession: vi.fn().mockResolvedValue({ id: "admin", role: "admin" }),
	};
	const invites = {
		listInvitations: vi.fn().mockResolvedValue([{ id: "inv-1", code: "TESTCODE" }]),
		listServers: vi.fn().mockResolvedValue([]),
	};
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false,
			httpsPort: false,
			mount: { "/api": [InvitesAdminController] },
			imports: [
				{ token: DefaultDataSource, use: {} },
				{ token: AuthService, use: auth },
				{ token: InvitesService, use: invites },
				{ token: PaymentsService, use: {} },
			],
		});
		await platform.listen(false);
	});

	afterAll(async () => {
		await platform?.stop();
	});

	it("matches GET /api/admin/invites without trailing slash", async () => {
		const rawApp = platform.adapter.app.getApp();
		const response = await rawApp.inject({
			method: "GET",
			url: "/api/admin/invites",
			headers: { authorization: "Bearer token" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([{ id: "inv-1", code: "TESTCODE" }]);
	});

	it("matches GET /api/admin/invites/ with trailing slash", async () => {
		const rawApp = platform.adapter.app.getApp();
		const response = await rawApp.inject({
			method: "GET",
			url: "/api/admin/invites/",
			headers: { authorization: "Bearer token" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([{ id: "inv-1", code: "TESTCODE" }]);
	});
});
