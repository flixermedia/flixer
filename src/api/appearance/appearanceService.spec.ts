import { describe, expect, it, vi } from "vitest";
import { Setting } from "../../entities/setting.entity.ts";
import { AppearanceService, LOGIN_LAYOUT_SETTING, LOGIN_LAYOUTS } from "./appearanceService.ts";

function setup(initial?: unknown) {
	const values = new Map<string, unknown>();
	if (initial !== undefined) values.set(LOGIN_LAYOUT_SETTING, initial);
	const settings = {
		findBy: vi.fn(async () => [...values].map(([key, value]) => ({ key, value }))),
		upsert: vi.fn(async ({ key, value }: { key: string; value: unknown }) => { values.set(key, value); }),
	};
	const themes = { find: vi.fn(async () => []), findBy: vi.fn(async () => []), findOneBy: vi.fn(async () => null) };
	const auth = { requireAdmin: vi.fn(async () => undefined) };
	const service = new AppearanceService({ getRepository: (entity: unknown) => entity === Setting ? settings : themes } as never, auth as never);
	return { service, auth, settings };
}

describe("browser login layout", () => {
	it("defaults to classic for missing or invalid stored settings", async () => {
		for (const value of [undefined, "unknown", null]) {
			const { service } = setup(value);
			expect((await service.publicState()).loginLayout).toBe("classic");
			expect((await service.adminState()).loginLayout).toBe("classic");
		}
	});

	it.each(LOGIN_LAYOUTS)("saves and publicly exposes %s", async (loginLayout) => {
		const { service, auth, settings } = setup();
		expect((await service.saveSettings({ loginLayout }, "admin")).loginLayout).toBe(loginLayout);
		expect((await service.publicState()).loginLayout).toBe(loginLayout);
		expect(settings.upsert).toHaveBeenCalledWith({ key: LOGIN_LAYOUT_SETTING, value: loginLayout, isPublic: false }, ["key"]);
		expect(auth.requireAdmin).toHaveBeenCalledWith("admin");
	});

	it("rejects invalid layout values", async () => {
		const { service, settings } = setup();
		for (const loginLayout of ["unknown", null, 1, {}]) {
			await expect(service.saveSettings({ loginLayout })).rejects.toThrow("Choose a valid login layout.");
		}
		expect(settings.upsert).not.toHaveBeenCalled();
	});
});