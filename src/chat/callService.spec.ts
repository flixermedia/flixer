import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "../config/store/appConfig.js";
import { CallService, derivedTurnSecret } from "./callService.js";

function serviceWith(settings: Record<string, unknown>, members: string[] = []) {
	const dataSource = {
		query: async (sql: string, params: string[]) =>
			sql.includes("chat_members")
				? members.map((user_id) => ({ user_id }))
				: params[0] in settings
					? [{ value: settings[params[0]] }]
					: [],
	};
	return new CallService(dataSource as never);
}

describe("CallService", () => {
	afterEach(() => vi.restoreAllMocks());

	it("refuses everything while calls are disabled", async () => {
		const service = serviceWith({ calls_enabled: false }, ["a", "b"]);
		await expect(service.iceConfig("a")).rejects.toThrow("disabled");
		await expect(service.recipients("a", "c")).rejects.toThrow("disabled");
	});

	it("returns other members and rejects non-members", async () => {
		const service = serviceWith({ calls_enabled: true }, ["a", "b", "c"]);
		expect(await service.recipients("a", "conv")).toEqual(["b", "c"]);
		await expect(service.recipients("z", "conv")).rejects.toThrow("not found");
	});

	it("issues short-lived TURN credentials from the admin secret, falling back to one derived from APP_SECRET", async () => {
		vi.spyOn(appConfig(), "get").mockReturnValue("a-very-long-app-secret-for-tests-0123456789");
		const settings = {
			calls_enabled: true,
			calls_stun_urls: ["stun:stun.example.org:3478"],
			calls_turn_urls: ["turn:turn.example.org:3478"],
			calls_relay_only: true,
		};
		const username = `${1_000 + 6 * 60 * 60}:user-1`;
		const hmac = (secret: string) => createHmac("sha1", secret).update(username).digest("base64");

		const derived = await serviceWith(settings).iceConfig("user-1", 1_000_000);
		expect(derived.relayOnly).toBe(true);
		expect(derived.iceServers[0]).toEqual({ urls: ["stun:stun.example.org:3478"] });
		expect(derived.iceServers[1]).toEqual({
			urls: ["turn:turn.example.org:3478"],
			username,
			credential: hmac(derivedTurnSecret("a-very-long-app-secret-for-tests-0123456789")),
		});

		const custom = await serviceWith({ ...settings, calls_turn_secret: " s3cret " }).iceConfig("user-1", 1_000_000);
		expect(custom.iceServers[1]?.credential).toBe(hmac("s3cret"));
	});

	it("uses a static TURN account when a username is configured", async () => {
		const config = await serviceWith({
			calls_enabled: true,
			calls_turn_urls: ["turn:free.example.org:3478"],
			calls_turn_username: " acct ",
			calls_turn_secret: " pw ",
		}).iceConfig("user-1");
		expect(config.iceServers).toEqual([{ urls: ["turn:free.example.org:3478"], username: "acct", credential: "pw" }]);
	});

	it("returns no TURN server when none is configured", async () => {
		const config = await serviceWith({ calls_enabled: true, calls_stun_urls: ["stun:a:1"], calls_relay_only: true }).iceConfig("u");
		expect(config).toEqual({ iceServers: [{ urls: ["stun:a:1"] }], relayOnly: false });
	});
});
