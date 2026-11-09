import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { LoggerService } from "./loggerService.js";

describe("logger log clearing", () => {
	let directory: string;
	let store: ConfigStore;
	const requireAdmin = vi.fn(async (authorization?: string) => {
		if (authorization !== "admin") throw new Error("forbidden");
	});

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-logger-clear-"));
		store = new ConfigStore(directory);
		setAppConfig(new AppConfig(store));
	});

	afterEach(() => {
		setAppConfig(undefined);
		store.close();
		vi.unstubAllGlobals();
		rmSync(directory, { recursive: true, force: true });
	});

	it("requires an admin and forwards the clear using the server-side management credential", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: "m".repeat(43) });
		const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
			expect(new Headers(init?.headers).has("authorization")).toBe(true);
			return new Response(JSON.stringify({ cleared: 12 }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });

		await expect(service.clearLogs("invalid")).rejects.toThrow("forbidden");
		expect(fetcher).not.toHaveBeenCalled();
		await expect(service.clearLogs("admin")).resolves.toEqual({ cleared: 12 });
		expect(fetcher).toHaveBeenCalledWith(
			"https://logger.example/api/logs/clear",
			expect.objectContaining({ method: "POST" }),
		);
	});
});
