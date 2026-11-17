import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../auth/authService.js";
import type { DuplicateSuggestionsService } from "./duplicateSuggestionsService.js";
import { AdminDuplicateSuggestionsController } from "./duplicateSuggestionsController.js";

describe("AdminDuplicateSuggestionsController", () => {
	it("requires admin access and forwards the bounded query", async () => {
		const requireAdmin = vi.fn().mockResolvedValue(undefined);
		const list = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, size: 50 });
		const controller = new AdminDuplicateSuggestionsController({ requireAdmin } as unknown as AuthService, { list } as unknown as DuplicateSuggestionsService);

		await expect(controller.list({ page: 2, size: 10 }, "Bearer token")).resolves.toEqual({ items: [], total: 0, page: 1, size: 50 });
		expect(requireAdmin).toHaveBeenCalledWith("Bearer token");
		expect(list).toHaveBeenCalledWith({ page: 2, size: 10 });
	});

	it("does not run the query when admin authorization fails", async () => {
		const requireAdmin = vi.fn().mockRejectedValue(new Error("forbidden"));
		const list = vi.fn();
		const controller = new AdminDuplicateSuggestionsController({ requireAdmin } as unknown as AuthService, { list } as unknown as DuplicateSuggestionsService);

		await expect(controller.list({}, undefined)).rejects.toThrow("forbidden");
		expect(list).not.toHaveBeenCalled();
	});
});
