import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DataSource, EntityManager } from "typeorm";
import type { AuthService } from "./authService.js";
import { QuickConnectService } from "./quickConnectService.js";
import { QuickConnectRequest } from "../../entities/quickConnectRequest.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";

const REQUEST_ID = "1b2f6d7e-9813-4f90-bd7d-9457af0ec0a1";
const POLL_TOKEN = "Y".repeat(43);
const USER_ID = "2b2f6d7e-9813-4f90-bd7d-9457af0ec0a2";

function hash(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function setup(enabled = true) {

	const requests = {
		create: vi.fn((request: unknown) => request),
		save: vi.fn(async (request: unknown) => request),
		delete: vi.fn().mockResolvedValue(undefined),
		findOne: vi.fn(),
		findOneBy: vi.fn(),
		update: vi.fn(),
		remove: vi.fn(),
	};
	const settings = {
		findOneBy: vi.fn().mockResolvedValue({ value: enabled }),
	};
	const users = {
		findOneBy: vi.fn().mockResolvedValue({ id: USER_ID, disabledAt: null }),
	};
	const manager = {
		getRepository: vi.fn((entity: unknown) => (entity === User ? users : requests)),
	};
	const dataSource = {
		getRepository: vi.fn((entity: unknown) => (entity === Setting ? settings : requests)),
		transaction: vi.fn((operation: (manager: EntityManager) => Promise<unknown>) => operation(manager as unknown as EntityManager)),
	} as unknown as DataSource;
	const authResult = {
		accessToken: "session-token",
		tokenType: "Bearer",
		expiresIn: 3600,
		session: { id: "session-id", expiresAt: new Date(Date.now() + 60_000) },
		user: { id: USER_ID, username: "test", displayName: "Test", email: null, role: "user" },
	};
	const authService = {
		requireAuthenticatedSession: vi.fn().mockResolvedValue({ user: { id: USER_ID } }),
		issueAuthResult: vi.fn().mockResolvedValue(authResult),
	} as unknown as AuthService;

	return {
		service: new QuickConnectService(dataSource, authService),
		dataSource,
		requests,
		settings,
		users,
		manager,
		authService,
		authResult,
	};

}

describe("QuickConnectService", () => {
	it("reports disabled status and refuses to start when the server setting is off", async () => {
		const { service, requests } = setup(false);

		await expect(service.getStatus()).resolves.toEqual({ enabled: false });
		await expect(service.start()).rejects.toThrow(/disabled/i);
		expect(requests.save).not.toHaveBeenCalled();
	});

	it("creates a short-lived request with only hashes of its code and polling token stored", async () => {
		const { service, requests } = setup();

		const result = await service.start();
		const stored = requests.save.mock.calls[0]?.[0] as {
			userCodeHash: string;
			pollTokenHash: string;
			expiresAt: Date;
		};

		expect(result.userCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
		expect(result.pollToken).toHaveLength(43);
		expect(stored.userCodeHash).toBe(hash(`quick-connect-code:${result.userCode}`));
		expect(stored.pollTokenHash).toBe(hash(`quick-connect-poll:${result.pollToken}`));
		expect(stored.userCodeHash).not.toContain(result.userCode);
		expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
		expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
	});

	it("consumes an approved request once and issues the normal session in its transaction", async () => {
		const { service, requests, manager, authService, authResult } = setup();
		const request = {
			id: REQUEST_ID,
			pollTokenHash: hash(`quick-connect-poll:${POLL_TOKEN}`),
			status: "approved",
			userId: USER_ID,
			expiresAt: new Date(Date.now() + 60_000),
		};
		requests.findOne.mockResolvedValueOnce(request).mockResolvedValueOnce(null);

		await expect(service.poll(REQUEST_ID, POLL_TOKEN)).resolves.toEqual({ status: "approved", auth: authResult });
		await expect(service.poll(REQUEST_ID, POLL_TOKEN)).rejects.toThrow(/invalid or has expired/i);

		expect(requests.findOne).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: REQUEST_ID, pollTokenHash: hash(`quick-connect-poll:${POLL_TOKEN}`) },
				lock: { mode: "pessimistic_write" },
			}),
		);
		expect(manager.getRepository).toHaveBeenCalledWith(User);
		expect(authService.issueAuthResult).toHaveBeenCalledOnce();
		expect(requests.remove).toHaveBeenCalledOnce();
	});

	it("authenticates and records an approval against a pending code", async () => {
		const { service, requests, authService } = setup();
		const request = { id: REQUEST_ID, expiresAt: new Date(Date.now() + 60_000) };
		requests.findOneBy.mockResolvedValue(request);
		requests.update.mockResolvedValue({ affected: 1 });

		await expect(service.approve("Bearer session-token", "2ABC-2345")).resolves.toMatchObject({ approved: true });

		expect(authService.requireAuthenticatedSession).toHaveBeenCalledWith("Bearer session-token");
		expect(requests.findOneBy).toHaveBeenCalledWith(
			expect.objectContaining({
				userCodeHash: hash("quick-connect-code:2ABC2345"),
				status: "pending",
			}),
		);
		expect(requests.update).toHaveBeenCalledWith(expect.objectContaining({ id: REQUEST_ID, status: "pending" }), { status: "approved", userId: USER_ID });
	});
});
