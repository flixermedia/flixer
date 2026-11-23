import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { appConfig } from "../../config/store/appConfig.js";
import { syncExternalInviteAccounts } from "../../jobs/inviteSyncJob.js";
import { InviteFulfillmentService } from "./inviteFulfillmentService.js";
import { encryptSecret } from "./inviteSecrets.js";
import { deleteExternalAccount, listExternalAccounts, parsePlexSharedServersXml } from "./mediaServerClient.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("external account deletion & listing", () => {
	it("deletes a Jellyfin/Emby user by id and treats 404 as already removed", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response("", { status: 404 }));
		vi.stubGlobal("fetch", fetchMock);

		await deleteExternalAccount("jellyfin", "https://jf.example.com/", "key-1", { externalUserId: "jf-123", externalEmail: null, username: "sam" });
		await deleteExternalAccount("emby", "https://emby.example.com", "key-2", { externalUserId: "emby-456", externalEmail: null, username: "sam" });

		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://jf.example.com/Users/jf-123");
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
		expect(fetchMock.mock.calls[1]?.[0]).toBe("https://emby.example.com/Users/emby-456");
	});

	it("parses Plex shared_servers XML and revokes by email when no shared_server id was stored", async () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?><MediaContainer size="2"><SharedServer id="101" username="alex" email="alex@example.com"/><SharedServer id="102" username="" email="sam@example.com"/></MediaContainer>`;
		expect(parsePlexSharedServersXml(xml)).toEqual([
			{ id: "101", username: "alex", email: "alex@example.com" },
			{ id: "102", username: null, email: "sam@example.com" },
		]);

		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ MediaContainer: { machineIdentifier: "mach-1" } }), { status: 200 }))
			.mockResolvedValueOnce(new Response(xml, { status: 200 }))
			.mockResolvedValueOnce(new Response("", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await deleteExternalAccount("plex", "https://plex.example.com", "plex-token", { externalUserId: null, externalEmail: "SAM@example.com", username: "sam" });

		expect(fetchMock.mock.calls[1]?.[0]).toBe("https://plex.tv/api/servers/mach-1/shared_servers");
		expect(fetchMock.mock.calls[2]?.[0]).toBe("https://plex.tv/api/servers/mach-1/shared_servers/102");
		expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe("DELETE");
	});

	it("lists Jellyfin users and returns null for other servers", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ Id: "u-1", Name: "alex" }]), { status: 200 })));
		await expect(listExternalAccounts("jellyfin", "https://jf.example.com", "key")).resolves.toEqual([{ id: "u-1", username: "alex", email: null }]);
		await expect(listExternalAccounts("other", "https://other.example.com", null)).resolves.toBeNull();
	});
});

describe("bi-directional deletion sync", () => {
	it("deprovisions linked Jellyfin account when deleting a Flixer user", async () => {
		vi.spyOn(appConfig(), "get").mockImplementation((key) => (key === "appSecret" ? "0123456789abcdef0123456789abcdef" : undefined));
		const encryptedKey = encryptSecret("jf-api-key");
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);

		const usages = [
			{
				userId: "user-1",
				username: "alex",
				status: "completed",
				externalUserId: "jf-99",
				externalEmail: null,
				invitation: { server: { id: "s1", name: "Jellyfin", type: "jellyfin", url: "https://jf.example.com", apiKeyEncrypted: encryptedKey, enabled: true } },
			},
		];
		const dataSource = { getRepository: () => ({ find: vi.fn().mockResolvedValue(usages) }) } as unknown as DataSource;

		await new InviteFulfillmentService(dataSource).deprovisionForUser("user-1");

		expect(fetchMock).toHaveBeenCalledWith("https://jf.example.com/Users/jf-99", expect.objectContaining({ method: "DELETE" }));
	});

	it("deletes Flixer users removed from Jellyfin/Plex while keeping existing users, admins and fresh accounts", async () => {
		vi.spyOn(appConfig(), "get").mockImplementation((key) => (key === "appSecret" ? "0123456789abcdef0123456789abcdef" : undefined));
		const encryptedKey = encryptSecret("jf-api-key");
		const oldDate = new Date(Date.now() - 120_000);
		const freshDate = new Date();

		const server = { id: "s1", name: "Jellyfin", type: "jellyfin", url: "https://jf.example.com", apiKeyEncrypted: encryptedKey, enabled: true };
		const usages = [
			{ id: "u-del", userId: "user-deleted", username: "gone", status: "completed", externalUserId: "jf-gone", externalEmail: null, createdAt: oldDate, invitation: { server } },
			{ id: "u-keep", userId: "user-present", username: "here", status: "completed", externalUserId: "jf-here", externalEmail: null, createdAt: oldDate, invitation: { server } },
			{ id: "u-admin", userId: "user-admin", username: "boss", status: "completed", externalUserId: "jf-admin-gone", externalEmail: null, createdAt: oldDate, invitation: { server } },
			{ id: "u-fresh", userId: "user-fresh", username: "newbie", status: "completed", externalUserId: "jf-new", externalEmail: null, createdAt: freshDate, invitation: { server } },
		];

		const usersById = new Map([
			["user-deleted", { id: "user-deleted", username: "gone", role: "user", preferences: null }],
			["user-present", { id: "user-present", username: "here", role: "user", preferences: null }],
			["user-admin", { id: "user-admin", username: "boss", role: "admin", preferences: null }],
			["user-fresh", { id: "user-fresh", username: "newbie", role: "user", preferences: null }],
		]);

		const remove = vi.fn().mockResolvedValue(undefined);
		const purgePayments = vi.fn().mockResolvedValue(undefined);
		const dataSource = {
			getRepository: (entity: { name?: string }) => (entity?.name === "InvitationUsage" ? { find: vi.fn().mockResolvedValue(usages) } : { findOneBy: vi.fn(({ id }: { id: string }) => Promise.resolve(usersById.get(id) ?? null)), remove }),
		} as unknown as DataSource;

		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ Id: "jf-here", Name: "here" }]), { status: 200 })));

		const result = await syncExternalInviteAccounts(dataSource, purgePayments);

		expect(result).toEqual({ checkedServers: 1, deletedUsers: 1 });
		expect(purgePayments).toHaveBeenCalledExactlyOnceWith("user-deleted");
		expect(remove).toHaveBeenCalledExactlyOnceWith(usersById.get("user-deleted"));
	});

	it("never deletes Flixer users when the external server is unreachable", async () => {
		vi.spyOn(appConfig(), "get").mockImplementation((key) => (key === "appSecret" ? "0123456789abcdef0123456789abcdef" : undefined));
		const encryptedKey = encryptSecret("jf-api-key");
		const server = { id: "s1", name: "Jellyfin", type: "jellyfin", url: "https://jf.example.com", apiKeyEncrypted: encryptedKey, enabled: true };
		const usages = [{ id: "u-1", userId: "user-1", username: "alex", status: "completed", externalUserId: "jf-1", externalEmail: null, createdAt: new Date(Date.now() - 120_000), invitation: { server } }];
		const remove = vi.fn();
		const dataSource = {
			getRepository: (entity: { name?: string }) => (entity?.name === "InvitationUsage" ? { find: vi.fn().mockResolvedValue(usages) } : { findOneBy: vi.fn(), remove }),
		} as unknown as DataSource;

		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

		const result = await syncExternalInviteAccounts(dataSource);

		expect(result).toEqual({ checkedServers: 0, deletedUsers: 0 });
		expect(remove).not.toHaveBeenCalled();
	});
});
