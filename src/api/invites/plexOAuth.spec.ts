import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { appConfig } from "../../config/store/appConfig.js";
import { InviteFulfillmentService } from "./inviteFulfillmentService.js";
import { encryptSecret } from "./inviteSecrets.js";
import { parsePlexServerSectionsXml, provisionExternalAccount } from "./mediaServerClient.js";
import { buildPlexAuthUrl, pollPlexInviteAuth, readPlexAuthTicket, startPlexInviteAuth } from "./plexOAuth.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("Plex invite OAuth PIN flow", () => {
	it("creates a strong Plex PIN and builds the official app.plex.tv auth URL", async () => {
		vi.spyOn(appConfig(), "get").mockImplementation((key) => {
			if (key === "appSecret") return "0123456789abcdef0123456789abcdef";
			if (key === "passkeyRpName") return "MyFlixer";
			return undefined;
		});
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 98765, code: "ABCD1234" }), { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);

		const started = await startPlexInviteAuth("welcome1");

		expect(fetchMock).toHaveBeenCalledWith("https://plex.tv/api/v2/pins?strong=true", expect.objectContaining({ method: "POST" }));
		expect(started.authUrl).toContain("https://app.plex.tv/auth#?");
		expect(started.authUrl).toContain("code=ABCD1234");
		expect(started.authUrl).toContain("context%5Bdevice%5D%5Bproduct%5D=MyFlixer");
		expect(buildPlexAuthUrl("cid-1", "PIN9", "Flixer")).toBe("https://app.plex.tv/auth#?clientID=cid-1&code=PIN9&context%5Bdevice%5D%5Bproduct%5D=Flixer");
	});

	it("polls pending then resolves the Plex profile into an invite-bound encrypted ticket", async () => {
		vi.spyOn(appConfig(), "get").mockImplementation((key) => {
			if (key === "appSecret") return "0123456789abcdef0123456789abcdef";
			if (key === "passkeyRpName") return "Flixer";
			return undefined;
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 555, code: "WXYZ" }), { status: 201 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 555, code: "WXYZ", authToken: null }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 555, code: "WXYZ", authToken: "user-plex-tok" }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 42, username: "plexalex", title: "Alex P", email: "Alex@Example.com", thumb: "https://plex.tv/u.png" }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const { sessionToken } = await startPlexInviteAuth("PLEX123");
		await expect(pollPlexInviteAuth("plex123", sessionToken)).resolves.toEqual({ status: "pending" });

		const done = await pollPlexInviteAuth("plex123", sessionToken);
		expect(done.status).toBe("authenticated");
		if (done.status !== "authenticated") throw new Error("expected authenticated");
		expect(done.account).toEqual({
			username: "plexalex",
			displayName: "Alex P",
			email: "alex@example.com",
			avatarUrl: "https://plex.tv/u.png",
		});

		const ticket = readPlexAuthTicket("PLEX123", done.plexAuthTicket);
		expect(ticket.plexToken).toBe("user-plex-tok");
		expect(ticket.plexEmail).toBe("alex@example.com");
		expect(() => readPlexAuthTicket("OTHERCODE", done.plexAuthTicket)).toThrow("expired");
	});

	it("auto-accepts the Plex shared server invite, maps local library keys to cloud section IDs, pins libraries, and opts out of online media sources", async () => {
		const sectionsXml = `<?xml version="1.0" encoding="UTF-8"?><MediaContainer size="2"><Server name="Ashley's Plex Server" machineIdentifier="mach-7"><Section id="135907556" key="4" type="movie" title="Movies"/><Section id="135907564" key="5" type="show" title="TV Shows"/></Server></MediaContainer>`;
		expect(parsePlexServerSectionsXml(sectionsXml)).toEqual([
			{ id: 135907556, key: "4", type: "movie", title: "Movies" },
			{ id: 135907564, key: "5", type: "show", title: "TV Shows" },
		]);

		const existingSettings = {
			settings: [
				{
					id: "experience",
					type: "json",
					value: JSON.stringify({
						autoHomeHubsEnabled: true,
						schemaVersion: 12,
						lastSourcePivots: {
							"myPlex--tv.plex.provider.discover--home": "/hubs/sections/home",
						},
						sidebarSettings: {
							hasCompletedSetup: false,
							pinnedSources: [
								{ key: "source--watchlist--myPlex--tv.plex.provider.discover--watchlist", sourceType: "watchlist", machineIdentifier: "myPlex", providerIdentifier: "tv.plex.provider.discover", isCloud: true },
								{ key: "source--movies--myPlex--tv.plex.provider.vod--movies", providerIdentifier: "tv.plex.provider.vod", isCloud: true },
							],
						},
					}),
				},
			],
		};
		const inviteXml = `<?xml version="1.0" encoding="UTF-8"?><MediaContainer size="1"><Invite id="4200" email="owner@example.com" username="owner" friend="1" home="0" server="1"><Server machineIdentifier="mach-7"/></Invite></MediaContainer>`;
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ MediaContainer: { machineIdentifier: "mach-7" } }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 4200, uuid: "owner-uuid", email: "owner@example.com", username: "owner" }), { status: 200 }))
			.mockResolvedValueOnce(new Response(sectionsXml, { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 777 }), { status: 201 }))
			.mockResolvedValueOnce(new Response(inviteXml, { status: 200 }))
			.mockResolvedValueOnce(new Response("", { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(existingSettings), { status: 200 }))
			.mockResolvedValueOnce(new Response("[]", { status: 201 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 900, uuid: "user-uuid", email: "alex@example.com", username: "plexalex" }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ "tv.plex.provider.vod": "opt_in", "tv.plex.provider.epg": "opt_in" }), { status: 200 }))
			.mockImplementation((input: string | URL) => {
				const url = String(input);
				if (url.includes("/settings/opt_outs?")) {
					return Promise.resolve(new Response("{}", { status: 201 }));
				}
				if (url.includes("/api/v2/resources")) {
					return Promise.resolve(new Response(JSON.stringify([{ clientIdentifier: "mach-7", accessToken: "shared-server-tok" }]), { status: 200 }));
				}
				return Promise.resolve(new Response("{}", { status: 200 }));
			});
		vi.stubGlobal("fetch", fetchMock);

		const result = await provisionExternalAccount("plex", "https://plex.example.com", "admin-tok", {
			username: "plexalex",
			password: "ignored",
			email: "alex@example.com",
			libraryIds: ["4", "TV Shows"],
			allowDownloads: true,
			plexUserToken: "user-tok",
			disableOnlineMediaSources: true,
		});

		expect(result).toEqual({ externalUserId: "777", invitedEmail: "alex@example.com", inviteAccepted: true });
		expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toMatchObject({ librarySectionIds: [135907556, 135907564] });
		expect(fetchMock.mock.calls[4]?.[0]).toBe("https://plex.tv/api/invites/requests");
		expect(fetchMock.mock.calls[5]?.[0]).toBe("https://plex.tv/api/invites/requests/4200?friend=1&home=0&server=1");
		expect((fetchMock.mock.calls[5]?.[1] as RequestInit).method).toBe("PUT");

		// Verify Plex Web shared experience settings were read and saved under X-Plex-Product: "Plex Web" with sharedSettings=1.
		expect(fetchMock.mock.calls[6]?.[0]).toBe("https://clients.plex.tv/api/v2/user?includeSettings=1&includeSharedSettings=1");
		expect((fetchMock.mock.calls[6]?.[1] as RequestInit).headers).toMatchObject({ "X-Plex-Product": "Plex Web" });
		expect(fetchMock.mock.calls[7]?.[0]).toBe("https://clients.plex.tv/api/v2/user/settings?sharedSettings=1");
		expect((fetchMock.mock.calls[7]?.[1] as RequestInit).headers).toMatchObject({ "X-Plex-Product": "Plex Web" });
		const outerSettingsBody = JSON.parse(String((fetchMock.mock.calls[7]?.[1] as RequestInit).body)) as { value: string };
		const settingsEntries = JSON.parse(outerSettingsBody.value) as Array<{ id: string; type: string; value: string; hidden: boolean }>;
		expect(settingsEntries[0]).toMatchObject({ id: "experience", type: "json", hidden: true });
		const savedExperience = JSON.parse(settingsEntries[0].value);
		expect(savedExperience.homeSettings.preferredServerID).toBe("mach-7");
		expect(savedExperience.sidebarSettings.hasCompletedSetup).toBe(true);
		expect(savedExperience.lastSourcePivots).toEqual({});
		expect(savedExperience.autoPinnedProviders).toEqual(expect.arrayContaining(["myPlex--tv.plex.provider.discover--home", "myPlex--tv.plex.provider.discover--watchlist", "myPlex--tv.plex.provider.vod--movies", "myPlex--tv.plex.provider.epg--home"]));
		expect(savedExperience.dismissedWhatsNewFeatures).toMatchObject({ "fd9f56d8-8858-490d-aede-05c29b06d584": true });
		expect(savedExperience.sidebarSettings.pinnedSources).toEqual([
			{
				key: "source--movies--mach-7--com.plexapp.plugins.library--4",
				sourceType: "movies",
				machineIdentifier: "mach-7",
				providerIdentifier: "com.plexapp.plugins.library",
				directoryID: "4",
				title: "Movies",
				serverFriendlyName: "Ashley's Plex Server",
				serverSourceTitle: null,
				isCloud: false,
				isFullOwnedServer: false,
				isHidden: false,
			},
			{
				key: "source--tv--mach-7--com.plexapp.plugins.library--5",
				sourceType: "tv",
				machineIdentifier: "mach-7",
				providerIdentifier: "com.plexapp.plugins.library",
				directoryID: "5",
				title: "TV Shows",
				serverFriendlyName: "Ashley's Plex Server",
				serverSourceTitle: null,
				isCloud: false,
				isFullOwnedServer: false,
				isHidden: false,
			},
		]);

		const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
		expect(calledUrls).toContain("https://plex.tv/api/v2/user/user-uuid/settings/opt_outs?key=includeDiscoverSource&value=opt_out");
		expect(calledUrls).toContain("https://plex.tv/api/v2/user/user-uuid/settings/opt_outs?key=includeMetadataInSearch&value=opt_out");
		expect(calledUrls).toContain("https://plex.tv/api/v2/user/user-uuid/settings/opt_outs?key=includeAvailabilities&value=opt_out");
		expect(calledUrls).toContain("https://plex.tv/api/v2/user/user-uuid/settings/opt_outs?key=includeSocialProof&value=opt_out");
		expect(calledUrls).toContain("https://plex.tv/api/v2/user/user-uuid/settings/opt_outs?key=tv.plex.provider.vod&value=opt_out");
		expect(calledUrls).toContain("https://plex.tv/api/v2/user/user-uuid/settings/opt_outs?key=tv.plex.provider.epg&value=opt_out");
		expect(calledUrls).toContain("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1");
		const warmCall = fetchMock.mock.calls.find((call) => String(call[0]) === "https://plex.example.com/library/sections");
		expect((warmCall?.[1] as RequestInit).headers).toMatchObject({ "X-Plex-Token": "shared-server-tok" });
	});

	it("creates Jellyfin accounts disabled until email verification and enables them on verify", async () => {
		vi.spyOn(appConfig(), "get").mockImplementation((key) => (key === "appSecret" ? "0123456789abcdef0123456789abcdef" : undefined));
		const encryptedKey = encryptSecret("jf-key");
		const server = { id: "s1", name: "Jellyfin", type: "jellyfin" as const, url: "https://jf.example.com", apiKeyEncrypted: encryptedKey, instructions: null };
		const invitation = { id: "inv-1", serverId: "s1", server, externalLibraryIds: [], allowDownloads: true, skipEmailVerification: false };
		const usage = { id: "u-1", userId: "user-1", username: "alex", status: "pending_verification", externalUserId: null as string | null, externalEmail: null as string | null, error: null, pendingCredentials: null, invitation };
		const save = vi.fn().mockResolvedValue(usage);
		const find = vi.fn().mockResolvedValue([usage]);
		const dataSource = { getRepository: () => ({ save, find }) } as unknown as DataSource;

		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ Id: "jf-user-1", Policy: { EnableLiveTvAccess: true } }), { status: 200 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ Id: "jf-user-1", Policy: { IsDisabled: true, EnableAllFolders: true } }), { status: 200 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);

		const service = new InviteFulfillmentService(dataSource);
		await service.fulfill(usage as never, invitation as never, { password: "secret", email: "alex@example.com" }, { requireVerification: true });

		expect(usage.status).toBe("pending_verification");
		expect(usage.externalUserId).toBe("jf-user-1");
		expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({ IsDisabled: true });

		await service.fulfillVerifiedForUser("user-1");

		expect(usage.status).toBe("completed");
		expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toMatchObject({ IsDisabled: false });
	});

	it("holds Plex shares until email verification then shares and auto-accepts on verify", async () => {
		vi.spyOn(appConfig(), "get").mockImplementation((key) => (key === "appSecret" ? "0123456789abcdef0123456789abcdef" : undefined));
		const encryptedKey = encryptSecret("plex-admin-tok");
		const server = { id: "s2", name: "Plex", type: "plex" as const, url: "https://plex.example.com", apiKeyEncrypted: encryptedKey, instructions: null };
		const invitation = { id: "inv-2", serverId: "s2", server, externalLibraryIds: [], allowDownloads: true, skipEmailVerification: false };
		const usage = { id: "u-2", userId: "user-2", username: "sam", status: "pending_verification", externalUserId: null as string | null, externalEmail: null as string | null, error: null, pendingCredentials: null as string | null, invitation };
		const save = vi.fn().mockResolvedValue(usage);
		const find = vi.fn().mockResolvedValue([usage]);
		const dataSource = { getRepository: () => ({ save, find }) } as unknown as DataSource;

		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ MediaContainer: { machineIdentifier: "mach-9" } }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 99, email: "owner@example.com", username: "owner" }), { status: 200 }))
			.mockResolvedValueOnce(new Response(`<MediaContainer><Server name="My Plex"><Section id="101" key="1" type="movie" title="Movies"/></Server></MediaContainer>`, { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 888 }), { status: 201 }))
			.mockResolvedValueOnce(new Response(`<MediaContainer><Invite id="99" friend="1" home="0" server="1"><Server machineIdentifier="mach-9"/></Invite></MediaContainer>`, { status: 200 }))
			.mockResolvedValueOnce(new Response("", { status: 200 }))
			.mockResolvedValueOnce(new Response("[]", { status: 200 }))
			.mockResolvedValueOnce(new Response("[]", { status: 201 }))
			.mockResolvedValueOnce(new Response(JSON.stringify([{ clientIdentifier: "mach-9", accessToken: "shared-tok-9" }]), { status: 200 }))
			.mockResolvedValueOnce(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const service = new InviteFulfillmentService(dataSource);
		await service.fulfill(usage as never, invitation as never, { password: "secret", email: "sam@example.com", plexUserToken: "sam-plex-tok" }, { requireVerification: true });

		expect(usage.status).toBe("pending_verification");
		expect(usage.pendingCredentials).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();

		const destination = await service.fulfillVerifiedForUser("user-2");

		expect(usage.status).toBe("completed");
		expect(usage.pendingCredentials).toBeNull();
		expect(usage.externalUserId).toBe("888");
		expect(destination?.invitedByEmail).toBe(false);
		expect(fetchMock.mock.calls[5]?.[0]).toBe("https://plex.tv/api/invites/requests/99?friend=1&home=0&server=1");
		expect(fetchMock.mock.calls[7]?.[0]).toBe("https://clients.plex.tv/api/v2/user/settings?sharedSettings=1");
	});

	it("recovers from Plex 422 when the user already has a share and still auto-accepts pending home/server invites", async () => {
		const sharedXml = `<?xml version="1.0" encoding="UTF-8"?><MediaContainer size="1"><SharedServer id="44310185" username="ashley82586" email="ashley@example.com"/></MediaContainer>`;
		const homeInviteXml = `<?xml version="1.0" encoding="UTF-8"?><MediaContainer size="1"><Invite id="4200" email="owner@example.com" username="donjbailey" friend="0" home="1" server="0"/></MediaContainer>`;
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ MediaContainer: { machineIdentifier: "mach-1" } }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 4200, uuid: "owner-uuid", email: "owner@example.com", username: "donjbailey" }), { status: 200 }))
			.mockResolvedValueOnce(new Response(`<MediaContainer><Server name="Ashley's Plex"><Section id="101" key="1" type="movie" title="Movies"/></Server></MediaContainer>`, { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "Already sharing" }] }), { status: 422 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ MediaContainer: { machineIdentifier: "mach-1" } }), { status: 200 }))
			.mockResolvedValueOnce(new Response(sharedXml, { status: 200 }))
			.mockResolvedValueOnce(new Response("{}", { status: 200 }))
			.mockResolvedValueOnce(new Response(homeInviteXml, { status: 200 }))
			.mockResolvedValueOnce(new Response("", { status: 200 }))
			.mockResolvedValueOnce(new Response("[]", { status: 200 }))
			.mockResolvedValueOnce(new Response("[]", { status: 201 }))
			.mockResolvedValueOnce(new Response(JSON.stringify([{ clientIdentifier: "mach-1", accessToken: "shared-tok-1" }]), { status: 200 }))
			.mockResolvedValueOnce(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await provisionExternalAccount("plex", "https://plex.example.com", "admin-tok", {
			username: "ashley82586",
			password: "ignored",
			email: "ashley@example.com",
			libraryIds: [],
			allowDownloads: true,
			plexUserToken: "user-tok",
		});

		expect(result).toEqual({ externalUserId: "44310185", invitedEmail: "ashley@example.com", inviteAccepted: true });
		expect(fetchMock.mock.calls[6]?.[0]).toBe("https://plex.tv/api/v2/shared_servers/44310185");
		expect((fetchMock.mock.calls[6]?.[1] as RequestInit).method).toBe("PUT");
		expect(fetchMock.mock.calls[8]?.[0]).toBe("https://plex.tv/api/invites/requests/4200?friend=0&home=1&server=0");
		expect((fetchMock.mock.calls[8]?.[1] as RequestInit).method).toBe("PUT");
		expect(fetchMock.mock.calls[10]?.[0]).toBe("https://clients.plex.tv/api/v2/user/settings?sharedSettings=1");
	});
});
