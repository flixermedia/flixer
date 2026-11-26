import { createPrivateKey, generateKeyPairSync, sign as signDetached } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { Setting } from "../../entities/setting.entity.js";
import { CloudEntitlementService } from "./cloudEntitlementService.js";
import { verifyEntitlementsToken } from "./cloudSecrets.js";

const TEST_PRIVATE_KEY_PEM = [
	"-----BEGIN PRIVATE KEY-----",
	"MC4CAQAwBQYDK2VwBCIEIPwb/vQicFxYnvRm8Ij+h7MtRDbsMyKF6HGz/QDN5Ps6",
	"-----END PRIVATE KEY-----",
].join("\n");

function signTestEntitlements(overrides: Record<string, unknown> = {}, privateKeyPem = TEST_PRIVATE_KEY_PEM): string {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const payload = {
		iss: "https://flixer.dev",
		aud: "flixer-server",
		sub: "uid1",
		linkId: "link1",
		serverInstanceId: null,
		account: { uid: "uid1", email: "admin@example.com", displayName: "Admin" },
		plans: [{ id: "priority_support", name: "Priority Support", status: "active", kind: "subscription", active: true, cancelAtPeriodEnd: false, currentPeriodEnd: null }],
		syncedAt: new Date(nowSeconds * 1000).toISOString(),
		iat: nowSeconds,
		exp: nowSeconds + 7 * 24 * 60 * 60,
		...overrides,
	};
	const headerB64 = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: (overrides.kid as string | undefined) ?? "v1" }), "utf8").toString("base64url");
	const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	const signingInput = `${headerB64}.${payloadB64}`;
	const sig = signDetached(null, Buffer.from(signingInput, "utf8"), createPrivateKey(privateKeyPem)).toString("base64url");
	return `${signingInput}.${sig}`;
}

function createFakeDataSource() {
	const store = new Map<string, Setting>();
	const repo = {
		findOneBy: vi.fn(async ({ key }: { key: string }) => store.get(key) ?? null),
		create: vi.fn((partial: Partial<Setting>) => ({ id: store.size + 1, updatedAt: new Date(), isPublic: false, ...partial }) as Setting),
		save: vi.fn(async (entity: Setting) => {
			store.set(entity.key, entity);
			return entity;
		}),
		delete: vi.fn(async ({ key }: { key: string }) => {
			store.delete(key);
		}),
	};
	return {
		store,
		dataSource: {
			getRepository: vi.fn(() => repo),
		} as unknown as DataSource,
	};
}

describe("CloudEntitlementService", () => {
	const originalAppSecret = process.env.APP_SECRET;

	beforeEach(() => {
		process.env.APP_SECRET = "0123456789abcdef0123456789abcdef";
	});

	afterEach(() => {
		process.env.APP_SECRET = originalAppSecret;
		vi.restoreAllMocks();
	});

	it("returns disconnected status when no cloud link is stored", async () => {
		const { dataSource } = createFakeDataSource();
		const service = new CloudEntitlementService(dataSource);
		const status = await service.getStatus();
		expect(status.connected).toBe(false);
		expect(status.plans).toEqual([]);
		expect(await service.hasActivePlan("priority_support")).toBe(false);
	});

	it("creates an OAuth authorize URL, verifies signed entitlements, and completes the callback", async () => {
		const { dataSource } = createFakeDataSource();
		const service = new CloudEntitlementService(dataSource);

		const { authorizeUrl } = await service.startOAuthConnect("https://media.example.com/admin/cloud/callback");
		const parsed = new URL(authorizeUrl);
		expect(parsed.pathname).toBe("/oauth/authorize");
		expect(parsed.searchParams.get("client_id")).toBe("flixer-server");
		expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
		const state = parsed.searchParams.get("state")!;
		const instanceId = parsed.searchParams.get("server_instance_id")!;
		expect(state).toBeTruthy();

		const entitlementsToken = signTestEntitlements({ serverInstanceId: instanceId });

		const fetchMock = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						access_token: "uid1.link1.acc",
						refresh_token: "uid1.link1.ref",
						expires_in: 3600,
						link_id: "link1",
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ entitlementsToken }),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

		const result = await service.completeOAuthCallback("auth-code-123", state);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.connected).toBe(true);
		expect(result.account?.email).toBe("admin@example.com");
		expect(await service.hasActivePlan("priority_support")).toBe(true);
		expect(await service.hasFeature("priority_support")).toBe(true);
		expect(await service.hasFeature("nonexistent_feature")).toBe(false);
		await expect(service.requireFeature("priority_support")).resolves.toBeUndefined();
		await expect(service.requireFeature("nonexistent_feature")).rejects.toThrow(/required/i);
		expect(await service.getActivePlanIds()).toEqual(["priority_support"]);
	});

	it("retains cached signed entitlements during offline grace period when sync fails with network error", async () => {
		const { dataSource } = createFakeDataSource();
		const service = new CloudEntitlementService(dataSource);

		const { authorizeUrl } = await service.startOAuthConnect("https://media.example.com/admin/cloud/callback");
		const parsed = new URL(authorizeUrl);
		const state = parsed.searchParams.get("state")!;
		const instanceId = parsed.searchParams.get("server_instance_id")!;
		const entitlementsToken = signTestEntitlements({ linkId: "l1", serverInstanceId: instanceId });

		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, link_id: "l1" }), { status: 200 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ entitlementsToken }), { status: 200 }),
			)
			.mockRejectedValueOnce(new Error("Network unreachable"));

		await service.completeOAuthCallback("code", state);
		const synced = await service.syncEntitlements();
		expect(synced.connected).toBe(true);
		expect(synced.stale).toBe(false);
		expect(synced.lastError).toContain("Network unreachable");
		expect(await service.hasActivePlan("priority_support")).toBe(true);
	});

	it("rejects forged or tampered entitlement tokens and instanceId mismatches", () => {
		const valid = signTestEntitlements({ serverInstanceId: "inst-1" });
		const [h, p, s] = valid.split(".");
		const tamperedPayload = Buffer.from(
			JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString("utf8")), plans: [] }),
			"utf8",
		).toString("base64url");
		expect(() => verifyEntitlementsToken(`${h}.${tamperedPayload}.${s}`)).toThrow(/signature verification failed/i);

		const { privateKey: rogueKey } = generateKeyPairSync("ed25519", {
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		const rogueToken = signTestEntitlements({}, rogueKey);
		expect(() => verifyEntitlementsToken(rogueToken)).toThrow(/signature verification failed/i);

		expect(() => verifyEntitlementsToken(valid, { instanceId: "inst-other" })).toThrow(/does not belong to this server instance/i);

		const unknownKid = signTestEntitlements({ kid: "v99" });
		expect(() => verifyEntitlementsToken(unknownKid)).toThrow(/Unknown Flixer Cloud signing key ID/i);
	});
});
