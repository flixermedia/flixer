import { describe, expect, it, vi } from "vitest";
import { PluginRuntimeController } from "./pluginRuntimeController.js";

describe("PluginRuntimeController", () => {
	it("invokes the plugin as the user resolved from an API key or session", async () => {
		const authService = { getUserFromKeyOrSession: vi.fn().mockResolvedValue({ id: "u1", role: "admin", email: "a@b.c" }) };
		const runtime = { invoke: vi.fn().mockResolvedValue({ ok: true }) };
		const controller = new PluginRuntimeController(authService as never, runtime as never);

		const result = await controller.invoke("flixer.example", "hello", { name: "Ada" }, "Bearer flx_key");

		expect(authService.getUserFromKeyOrSession).toHaveBeenCalledWith("Bearer flx_key");
		expect(runtime.invoke).toHaveBeenCalledWith("flixer.example", "hello", { id: "u1", role: "admin" }, { name: "Ada" });
		expect(result).toEqual({ ok: true });
	});
});
