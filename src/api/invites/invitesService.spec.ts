import { describe, expect, it, vi } from "vitest";
import { getJsonSchema } from "@tsed/schema";
import type { DataSource } from "typeorm";
import type { Invitation } from "../../entities/invitation.entity.js";
import type { InviteServer } from "../../entities/inviteServer.entity.js";
import { UpdateInvitationRequest } from "./inviteRequests.js";
import { InvitesService } from "./invitesService.js";
import { MIN_SUPPORTED_PLEX_VERSION, comparePlexVersions, provisionExternalAccount, testMediaServerConnection } from "./mediaServerClient.js";

function serviceWith(invitation: Partial<Invitation> | null): InvitesService {
	const dataSource = {
		getRepository: () => ({ findOneBy: async () => invitation }),
	} as unknown as DataSource;
	return new InvitesService(dataSource);
}

const validInvitation: Partial<Invitation> = {
	id: "f5a0e1d4-0000-4000-8000-000000000001",
	code: "WELCOME1",
	disabled: false,
	expiresAt: null,
	maxUses: null,
	usedCount: 0,
	serverId: null,
};

describe("findRedeemable", () => {
	it("returns a valid invitation regardless of the code's casing", async () => {
		const invitation = await serviceWith(validInvitation).findRedeemable("welcome1");
		expect(invitation.code).toBe("WELCOME1");
	});

	it("rejects unknown codes", async () => {
		await expect(serviceWith(null).findRedeemable("NOPE")).rejects.toThrow("This invite does not exist or is no longer active.");
	});

	it("rejects disabled invitations", async () => {
		await expect(serviceWith({ ...validInvitation, disabled: true }).findRedeemable("WELCOME1")).rejects.toThrow("no longer active");
	});

	it("rejects expired invitations", async () => {
		await expect(serviceWith({ ...validInvitation, expiresAt: new Date(Date.now() - 1000) }).findRedeemable("WELCOME1")).rejects.toThrow("This invite has expired.");
	});

	it("rejects invitations whose uses ran out", async () => {
		await expect(serviceWith({ ...validInvitation, maxUses: 2, usedCount: 2 }).findRedeemable("WELCOME1")).rejects.toThrow("This invite has already been used.");
	});

	it("rejects invitations whose media server was switched off", async () => {
		const invitation = { ...validInvitation, serverId: "f5a0e1d4-0000-4000-8000-000000000002", server: { enabled: false } as never };
		await expect(serviceWith(invitation).findRedeemable("WELCOME1")).rejects.toThrow("no longer active");
	});
});

describe("media server client", () => {
	it('does nothing for "other" servers', async () => {
		const account = { username: "sam", password: "secret", email: "sam@example.com", libraryIds: [], allowDownloads: true };
		await expect(provisionExternalAccount("other", "https://example.com", null, account)).resolves.toEqual({ externalUserId: null, invitedEmail: null });
		await expect(testMediaServerConnection("other", "https://example.com", null)).resolves.toBeUndefined();
	});

	it("requires credentials before talking to Jellyfin or Plex", async () => {
		const account = { username: "sam", password: "secret", email: "sam@example.com", libraryIds: [], allowDownloads: true };
		await expect(provisionExternalAccount("jellyfin", "https://example.com", null, account)).rejects.toThrow("no API key");
		await expect(provisionExternalAccount("plex", "https://example.com", null, account)).rejects.toThrow("no token");
		await expect(testMediaServerConnection("emby", "https://example.com", null)).rejects.toThrow("An API key is required.");
	});

	it("authenticates with both the legacy and the MediaBrowser header, which Jellyfin 12 requires", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			await testMediaServerConnection("jellyfin", "https://example.com/", "the-key");
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("https://example.com/System/Info");
			const headers = init.headers as Record<string, string>;
			expect(headers["X-Emby-Token"]).toBe("the-key");
			expect(headers.Authorization).toContain('MediaBrowser Token="the-key"');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("explains a rejected API key instead of only quoting the status", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
		try {
			await expect(testMediaServerConnection("jellyfin", "https://example.com", "wrong")).rejects.toThrow("rejected the saved API key (status 401)");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("blocks out-of-date Plex Media Server versions and SERVER_NOT_SUPPORTED servers when adding or testing", async () => {
		expect(comparePlexVersions("1.41.7.9799-5bce000f7", MIN_SUPPORTED_PLEX_VERSION)).toBe(-1);
		expect(comparePlexVersions(MIN_SUPPORTED_PLEX_VERSION, MIN_SUPPORTED_PLEX_VERSION)).toBe(0);
		expect(comparePlexVersions("1.43.5.11079-b3b13e506", MIN_SUPPORTED_PLEX_VERSION)).toBe(1);

		const save = vi.fn();
		const create = vi.fn((value: unknown) => value);
		const service = new InvitesService({ getRepository: () => ({ create, save }) } as unknown as DataSource);

		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ MediaContainer: { machineIdentifier: "mach-old", version: "1.41.7.9799-5bce000f7" } }), { status: 200 })));
		try {
			await expect(
				service.createServer({
					name: "Old Plex",
					type: "plex",
					url: "https://plex.example.com",
					apiKey: "tok",
				}),
			).rejects.toThrow(`running version 1.41.7.9799-5bce000f7, which is out of date`);
			expect(save).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}

		// Even if version is newer, reject if plex.tv reports SERVER_NOT_SUPPORTED on shared_servers.
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ MediaContainer: { machineIdentifier: "mach-blocked", version: "1.43.5.11079-b3b13e506" } }), { status: 200 }))
				.mockResolvedValueOnce(new Response(`<MediaContainer><SharedServer id="1" accessToken="SERVER_NOT_SUPPORTED"/></MediaContainer>`, { status: 200 })),
		);
		try {
			await expect(testMediaServerConnection("plex", "https://plex.example.com", "tok")).rejects.toThrow("SERVER_NOT_SUPPORTED");
		} finally {
			vi.unstubAllGlobals();
		}

		// Supported version with clean shared_servers passes.
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ MediaContainer: { machineIdentifier: "mach-ok", version: "1.43.5.11079-b3b13e506" } }), { status: 200 }))
				.mockResolvedValueOnce(new Response(`<MediaContainer size="0"></MediaContainer>`, { status: 200 })),
		);
		try {
			await expect(testMediaServerConnection("plex", "https://plex.example.com", "tok")).resolves.toBeUndefined();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("updateInvitation", () => {
	function createUpdateService(invitation: Invitation, servers: InviteServer[] = []) {
		const save = vi.fn().mockImplementation(async (entity: Invitation) => entity);
		const dataSource = {
			getRepository: (target: { name?: string }) => {
				if (target.name === "InviteServer") {
					return { findOneBy: async ({ id }: { id: string }) => servers.find((s) => s.id === id) ?? null };
				}
				return {
					findOneBy: async ({ id }: { id: string }) => (id === invitation.id ? invitation : null),
					save,
				};
			},
		} as unknown as DataSource;
		return { service: new InvitesService(dataSource), save };
	}

	const baseInvitation = (): Invitation =>
		({
			id: "f5a0e1d4-0000-4000-8000-000000000001",
			code: "WELCOME1",
			label: "Friends",
			serverId: null,
			server: null,
			maxUses: 5,
			usedCount: 0,
			expiresAt: new Date("2027-01-01T00:00:00.000Z"),
			disabled: false,
			libraryMode: "all",
			libraryIds: [],
			externalLibraryIds: [],
			allowDownloads: true,
			skipPayment: false,
			skipEmailVerification: false,
			disablePlexOnlineSources: false,
			userExpiresInDays: 30,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		}) as unknown as Invitation;

	it("updates editable fields, clears nullable limits, and switches destination before first use", async () => {
		const plexServer = { id: "s-plex", name: "Home Plex", type: "plex" } as InviteServer;
		const { service } = createUpdateService(baseInvitation(), [plexServer]);

		const updated = await service.updateInvitation("f5a0e1d4-0000-4000-8000-000000000001", {
			code: "vip-2026",
			label: "  ",
			serverId: "s-plex",
			maxUses: null,
			expiresAt: null,
			userExpiresInDays: null,
			libraryMode: "selected",
			libraryIds: ["lib-1"],
			externalLibraryIds: ["1", "2"],
			allowDownloads: false,
			skipPayment: true,
			skipEmailVerification: true,
			disablePlexOnlineSources: true,
		});

		expect(updated.code).toBe("VIP-2026");
		expect(updated.label).toBeNull();
		expect(updated.server).toEqual({ id: "s-plex", name: "Home Plex", type: "plex" });
		expect(updated.maxUses).toBeNull();
		expect(updated.expiresAt).toBeNull();
		expect(updated.userExpiresInDays).toBeNull();
		expect(updated.libraryMode).toBe("selected");
		expect(updated.libraryIds).toEqual(["lib-1"]);
		expect(updated.externalLibraryIds).toEqual(["1", "2"]);
		expect(updated.allowDownloads).toBe(false);
		expect(updated.skipPayment).toBe(true);
		expect(updated.skipEmailVerification).toBe(true);
		expect(updated.disablePlexOnlineSources).toBe(true);
	});

	it("rejects changing the destination server after an invitation has been used", async () => {
		const used = { ...baseInvitation(), usedCount: 1 } as Invitation;
		const { service } = createUpdateService(used);

		await expect(service.updateInvitation(used.id, { serverId: "s-plex" })).rejects.toThrow("Destination server cannot be changed after an invitation has been used.");
	});

	it("marks nullable update fields as nullable in the Ts.ED JSON schema", () => {
		const schema = getJsonSchema(UpdateInvitationRequest);
		for (const field of ["label", "serverId", "maxUses", "expiresAt", "userExpiresInDays"] as const) {
			const prop = schema.properties?.[field] as { type?: string | string[] } | undefined;
			expect(prop?.type, `expected ${field} schema to accept null`).toContain("null");
		}
	});
});
