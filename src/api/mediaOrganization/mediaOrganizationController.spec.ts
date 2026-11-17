import { describe, expect, it, vi } from "vitest";
import { MediaOrganizationController } from "./mediaOrganizationController.js";

describe("MediaOrganizationController password confirmation", () => {
	const libraryId = "00000000-0000-4000-8000-000000000001";
	const planId = "00000000-0000-4000-8000-000000000002";
	const actorId = "00000000-0000-4000-8000-000000000003";

	it("verifies the current admin password before execute and does not forward it", async () => {
		const auth = {
			requireAdminSession: vi.fn().mockResolvedValue({ user: { id: actorId } }),
			assertPassword: vi.fn().mockResolvedValue(undefined),
		};
		const organization = { execute: vi.fn().mockResolvedValue({ state: "completed" }) };
		const controller = new MediaOrganizationController(auth as never, organization as never);

		await expect(controller.execute(libraryId, planId, { password: "entered-at-runtime" }, "Bearer session")).resolves.toEqual({ state: "completed" });
		expect(auth.assertPassword).toHaveBeenCalledWith("Bearer session", "entered-at-runtime");
		expect(organization.execute).toHaveBeenCalledWith(libraryId, planId, actorId);
		expect(JSON.stringify(organization.execute.mock.calls)).not.toContain("entered-at-runtime");
	});

	it("does not rollback when password verification fails", async () => {
		const auth = {
			requireAdminSession: vi.fn().mockResolvedValue({ user: { id: actorId } }),
			assertPassword: vi.fn().mockRejectedValue(new Error("Your password is incorrect.")),
		};
		const organization = { rollback: vi.fn() };
		const controller = new MediaOrganizationController(auth as never, organization as never);

		await expect(controller.rollback(libraryId, planId, { password: "wrong" }, "Bearer session")).rejects.toThrow("Your password is incorrect.");
		expect(organization.rollback).not.toHaveBeenCalled();
	});

	it("verifies the current admin password before recovering and does not forward it", async () => {
		const auth = {
			requireAdminSession: vi.fn().mockResolvedValue({ user: { id: actorId } }),
			assertPassword: vi.fn().mockResolvedValue(undefined),
		};
		const organization = { recoverUnmovedPlan: vi.fn().mockResolvedValue({ state: "failed" }) };
		const controller = new MediaOrganizationController(auth as never, organization as never);

		await expect(controller.recover(libraryId, planId, { password: "entered-at-runtime" }, "Bearer session")).resolves.toEqual({ state: "failed" });
		expect(auth.assertPassword).toHaveBeenCalledWith("Bearer session", "entered-at-runtime");
		expect(organization.recoverUnmovedPlan).toHaveBeenCalledWith(libraryId, planId, actorId);
		expect(JSON.stringify(organization.recoverUnmovedPlan.mock.calls)).not.toContain("entered-at-runtime");
	});

	it("does not recover when password verification fails", async () => {
		const auth = {
			requireAdminSession: vi.fn().mockResolvedValue({ user: { id: actorId } }),
			assertPassword: vi.fn().mockRejectedValue(new Error("Your password is incorrect.")),
		};
		const organization = { recoverUnmovedPlan: vi.fn() };
		const controller = new MediaOrganizationController(auth as never, organization as never);

		await expect(controller.recover(libraryId, planId, { password: "wrong" }, "Bearer session")).rejects.toThrow("Your password is incorrect.");
		expect(organization.recoverUnmovedPlan).not.toHaveBeenCalled();
	});
});
