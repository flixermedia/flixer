import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveUpdaterToken, isNewer, parseVersion, UpdateService } from "./updateService.js";
import { version } from "../../config/config.js";
import { VersionController } from "../versionController.js";

describe("deriveUpdaterToken", () => {
	it("matches the updater's HMAC derivation", () => {
		expect(deriveUpdaterToken("secret")).toBe("d171f4d65c41290afa1ba74b5aebaccc3ee1a6c7811ec0e9ddeaa6433180b65c");
		expect(deriveUpdaterToken("")).toBeUndefined();
	});
});

describe("update versions", () => {
	it("reports explicit development API builds without changing release versions", async () => {
		const repository = { findOneBy: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(undefined) };
		const updater = { token: () => undefined };
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
		try {
			vi.stubEnv("FLIXER_DEVELOPMENT_BUILD", "true");
			const service = new UpdateService({ getRepository: () => repository } as never, {} as never, updater as never);
			expect(new VersionController().get().version).toBe(`${version}-dev`);
			expect((await service.status()).components).toContainEqual(expect.objectContaining({ id: "flixer", installed: `${version}-dev`, updateAvailable: false }));
			vi.stubEnv("FLIXER_DEVELOPMENT_BUILD", "");
			expect(new VersionController().get().version).toBe(version);
			expect((await service.status()).components).toContainEqual(expect.objectContaining({ id: "flixer", installed: version }));
		} finally {
			vi.unstubAllEnvs();
			vi.unstubAllGlobals();
		}
	});

	it("parses stable versions only", () => {
		expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
		expect(parseVersion("0.10.0")).toEqual([0, 10, 0]);
		expect(parseVersion("dev")).toBeNull();
		expect(parseVersion("1.2.3-beta")).toBeNull();
		expect(parseVersion(null)).toBeNull();
	});

	it("compares numerically, not as text", () => {
		expect(isNewer("0.10.0", "0.9.5")).toBe(true);
		expect(isNewer("1.0.0", "0.99.99")).toBe(true);
		expect(isNewer("1.2.3", "1.2.3")).toBe(false);
		expect(isNewer("1.2.2", "1.2.3")).toBe(false);
	});

	it("uses validated public release redirects when GitHub rate limits the API", async () => {
		const repository = { findOneBy: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(undefined) };
		const updater = { token: () => undefined };
		vi.stubGlobal("fetch", vi.fn(async (url: string) => {
			if (url.startsWith("https://api.github.com/")) {
				return new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
			}
			if (url.startsWith("https://github.com/")) {
				const repo = new URL(url).pathname.split("/")[2];
				const target = repo === "flixer-ai" ? `/flixermedia/${repo}/releases`
					: repo === "flixer-logger" ? "https://example.com/flixermedia/flixer-logger/releases/tag/v9.0.0"
						: `/flixermedia/${repo}/releases/tag/v1.2.3`;
				return new Response(null, { status: 302, headers: { location: target } });
			}
			return Response.json({});
		}));
		try {
			const service = new UpdateService({ getRepository: () => repository } as never, {} as never, updater as never);
			const status = await service.status(true);
			expect(status.components).toContainEqual(expect.objectContaining({ id: "flixer", latest: "1.2.3" }));
			expect(status.components).toContainEqual(expect.objectContaining({ id: "ai", latest: null }));
			expect(status.components).toContainEqual(expect.objectContaining({ id: "logger", latest: null }));
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("keeps the previous version for an individual failed lookup", async () => {
		const repository = { findOneBy: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(undefined) };
		const updater = { token: () => undefined };
		let failing = false;
		vi.stubGlobal("fetch", vi.fn(async (url: string) => {
			if (url.includes("flixer-ai/releases/latest")) {
				return failing ? new Response("", { status: 503 }) : Response.json({ tag_name: "v1.2.3" });
			}
			if (url.startsWith("https://api.github.com/")) return new Response("", { status: 404 });
			return Response.json({});
		}));
		try {
			const service = new UpdateService({ getRepository: () => repository } as never, {} as never, updater as never);
			expect((await service.status(true)).components).toContainEqual(expect.objectContaining({ id: "ai", latest: "1.2.3" }));
			failing = true;
			expect((await service.status(true)).components).toContainEqual(expect.objectContaining({ id: "ai", latest: "1.2.3" }));
		} finally {
			vi.unstubAllGlobals();
		}
	});

	describe("updater capabilities", () => {
		afterEach(() => vi.unstubAllGlobals());

		it("disables updates for native development while preserving Compose support", async () => {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
			const repository = { findOneBy: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(undefined) };
			const updater = {
				token: () => "token",
				call: vi.fn().mockImplementation(async () => new Response(JSON.stringify({ mode: "development", state: { run: null } }))),
			};
			const service = new UpdateService({ getRepository: () => repository } as never, {} as never, updater as never);
			expect(await service.status()).toMatchObject({ updaterReachable: true, updaterMode: "development", canApply: false });
			await expect(service.apply()).rejects.toThrow("Native development checkouts");
			updater.call.mockImplementation(async () => new Response(JSON.stringify({ state: { run: null } })));
			expect(await service.status()).toMatchObject({ updaterReachable: true, updaterMode: "compose", canApply: true });
		});
	});

	it("never treats development builds or missing versions as outdated", () => {
		expect(isNewer("9.9.9", "dev")).toBe(false);
		expect(isNewer(null, "1.0.0")).toBe(false);
		expect(isNewer("1.0.0", undefined)).toBe(false);
	});
});
