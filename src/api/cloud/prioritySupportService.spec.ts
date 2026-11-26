import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Forbidden } from "@tsed/exceptions";
import type { CloudEntitlementService } from "./cloudEntitlementService.js";
import { PrioritySupportService } from "./prioritySupportService.js";

function createMockEntitlements(entitled: boolean): CloudEntitlementService {
	return {
		requireFeature: vi.fn(async (feature: string) => {
			if (!entitled) {
				throw new Forbidden(`An active flixer.dev membership granting "${feature}" is required.`);
			}
		}),
		getValidAccessToken: vi.fn(async () => "uid1.link1.tok"),
		getCloudApiBaseUrl: vi.fn(() => "https://us-central1-flixermedia.cloudfunctions.net"),
		getStatus: vi.fn(async () => ({
			connected: entitled,
			stale: false,
			autoSyncEnabled: true,
			gracePeriodDays: 7,
			instanceId: "inst-1",
			account: { uid: "uid1", email: "admin@example.com", displayName: "Admin" },
			linkId: "link1",
			plans: entitled
				? [{ id: "priority_support", name: "Priority Support", status: "active", kind: "subscription" as const, active: true, cancelAtPeriodEnd: false, currentPeriodEnd: null, features: ["priority_support"] }]
				: [],
			features: entitled ? ["priority_support"] : [],
			syncedAt: "2026-11-26T18:00:00.000Z",
			lastSyncAttemptAt: "2026-11-26T18:00:00.000Z",
			lastError: null,
			cloudWebUrl: "https://flixer.dev",
		})),
	} as unknown as CloudEntitlementService;
}

describe("PrioritySupportService", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("blocks diagnostics and chat with Forbidden when priority_support feature is missing", async () => {
		const service = new PrioritySupportService(createMockEntitlements(false));
		await expect(service.getDiagnostics()).rejects.toThrow(Forbidden);
		await expect(service.getMessages()).rejects.toThrow(Forbidden);
		await expect(service.sendMessage("hello")).rejects.toThrow(Forbidden);
	});

	it("returns formatted server diagnostics without secrets when entitled", async () => {
		const service = new PrioritySupportService(createMockEntitlements(true));
		const diag = await service.getDiagnostics();
		expect(diag.instanceId).toBe("inst-1");
		expect(diag.activePlans).toEqual(["Priority Support (priority_support)"]);
		expect(diag.formattedText).toContain("Flixer Version:");
		expect(diag.formattedText).toContain("Priority Support (priority_support)");
	});

	it("proxies GET and POST messages to flixer-cloud prioritySupportChat", async () => {
		const service = new PrioritySupportService(createMockEntitlements(true));
		const fetchMock = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						room: { rid: "room-1", open: true },
						messages: [{ id: "m1", sender: "agent", senderName: "Support", text: "Hi!", timestamp: "2026-11-26T18:00:00.000Z" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						room: { rid: "room-1", open: true },
						message: { id: "m2", sender: "customer", senderName: "You", text: "Need help", timestamp: "2026-11-26T18:01:00.000Z" },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

		const history = await service.getMessages();
		expect(history.room?.rid).toBe("room-1");
		expect(history.messages).toHaveLength(1);

		const sent = await service.sendMessage("Need help");
		expect(sent.message.text).toBe("Need help");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
