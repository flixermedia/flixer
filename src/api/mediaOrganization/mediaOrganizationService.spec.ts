import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { NetworkSharesService } from "../networkShares/networkSharesService.ts";
import { MediaItem } from "../../entities/mediaItem.entity.ts";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.ts";
import { MediaOrganizationPlan, MediaOrganizationPlanAudit, MediaOrganizationSettings } from "../../entities/mediaOrganization.entity.ts";
import { MediaOrganizationService } from "./mediaOrganizationService.ts";
import { MediaRootsService } from "../mediaLibraries/mediaRootsService.ts";

describe("media organization service", () => {
	let directory: string;
	let rootId: string;
	let service: MediaOrganizationService;
	let items: MediaItem[];
	let plans: MediaOrganizationPlan[];
	let audit: MediaOrganizationPlanAudit[];
	const previousRoot = process.env.STREAM_MEDIA_ROOT;
	let savedSettings: Partial<MediaOrganizationSettings> | null;

	function setup(itemPaths: string[]) {
		const library = Object.assign(new MediaLibrary(), {
			id: "00000000-0000-4000-8000-000000000001",
			name: "Movies",
			type: "movies",
			imageStorage: "cache",
			folders: [{ rootId, path: "Library" }],
			createdAt: new Date(),
		});
		items = itemPaths.map((relativePath, index) =>
			Object.assign(new MediaItem(), {
				id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
				libraryId: library.id,
				parentId: null,
				type: "movie",
				externalKey: `tmdb:${index + 1}`,
				path: join(directory, relativePath),
				rootId,
				relativePath,
				title: "Film",
				year: 2024,
				seasonNumber: null,
				episodeNumber: null,
				episodeEndNumber: null,
				providerIds: {},
				matchConfidence: "high",
				matchEvidence: "test",
				metadata: {},
				images: [],
				technical: null,
				sizeBytes: null,
				modifiedAt: null,
				nfoPresent: false,
				localImagesUsed: false,
				isPlaceholder: false,
				editedFields: [],
				lastSeenAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		);
		plans = [];
		audit = [];
		savedSettings = null;
		const repositories = new Map<unknown, Record<string, (...args: any[]) => any>>();
		repositories.set(MediaLibrary, { findOneBy: vi.fn().mockResolvedValue(library) });
		repositories.set(MediaOrganizationSettings, {
			findOneBy: vi.fn(async () => savedSettings),
			save: vi.fn(async (value) => {
				savedSettings = { ...savedSettings, ...value };
				return savedSettings;
			}),
		});
		repositories.set(MediaItem, { find: vi.fn(async () => items) });
		repositories.set(MediaOrganizationPlan, {
			create: vi.fn((value) => Object.assign(new MediaOrganizationPlan(), value)),
			save: vi.fn(async (value) => {
				const index = plans.findIndex((entry) => entry.id === value.id);
				if (index < 0) plans.push(value);
				else plans[index] = value;
				return value;
			}),
			findOneBy: vi.fn(async ({ id }) => plans.find((entry) => entry.id === id) ?? null),
			find: vi.fn(async () => plans),
		});
		repositories.set(MediaOrganizationPlanAudit, {
			save: vi.fn(async (value) => {
				audit.push(value);
				return value;
			}),
			find: vi.fn(async () => audit),
		});
		const source = {
			getRepository: (entity: unknown) => repositories.get(entity),
			query: async (sql: string, params: unknown[]) => {
				if (sql.includes("WITH claimed AS")) {
					const [nextState, error, id, libraryId, expectedState, auditId, actorId, action, details] = params as string[];
					const plan = plans.find((entry) => entry.id === id && entry.libraryId === libraryId && entry.state === expectedState);
					if (!plan) return [];
					plan.state = nextState as MediaOrganizationPlan["state"];
					plan.error = error;
					audit.push(Object.assign(new MediaOrganizationPlanAudit(), { id: auditId, planId: id, actorId, action, details: JSON.parse(details) }));
					return [{ id }];
				}
				const [nextState, id, libraryId, expectedState] = params as string[];
				const plan = plans.find((entry) => entry.id === id && entry.libraryId === libraryId && entry.state === expectedState);
				if (!plan) return [];
				plan.state = nextState as MediaOrganizationPlan["state"];
				return [{ id }];
			},
		} as unknown as DataSource;
		const roots = new MediaRootsService({ roots: () => [] } as unknown as NetworkSharesService);
		service = new MediaOrganizationService(source, roots);
	}

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "flixer-media-organization-"));
		await mkdir(join(directory, "Library"), { recursive: true });
		process.env.STREAM_MEDIA_ROOT = directory;
		rootId = new MediaRootsService({ roots: () => [] } as unknown as NetworkSharesService).list()[0].id;
	});

	afterEach(async () => {
		if (previousRoot === undefined) delete process.env.STREAM_MEDIA_ROOT;
		else process.env.STREAM_MEDIA_ROOT = previousRoot;
		await rm(directory, { recursive: true, force: true });
	});

	it("keeps independent write permissions disabled until saved in the dashboard", async () => {
		const libraryId = "00000000-0000-4000-8000-000000000001";
		setup([]);
		await expect(service.settings(libraryId)).resolves.toMatchObject({ organizationWritesEnabled: false, nfoWritesEnabled: false });
		await expect(service.setWritePermissions(libraryId, { organizationWritesEnabled: false, nfoWritesEnabled: true })).resolves.toEqual({
			organizationWritesEnabled: false,
			nfoWritesEnabled: true,
		});
		await expect(service.settings(libraryId)).resolves.toMatchObject({ organizationWritesEnabled: false, nfoWritesEnabled: true });
	});

	it("rejects a second execute request while a plan is already running", async () => {
		await writeFile(join(directory, "Library", "Film.mkv"), "film-bytes");
		setup(["Library/Film.mkv"]);
		const libraryId = "00000000-0000-4000-8000-000000000001";
		const actorId = "00000000-0000-4000-8000-000000000099";
		await service.setWritePermissions(libraryId, { organizationWritesEnabled: true, nfoWritesEnabled: false });
		const plan = await service.createPlan(libraryId, actorId);
		plan.state = "executing";
		plans[0] = plan;
		await expect(service.execute(libraryId, plan.id, actorId)).rejects.toThrow("This plan is already being executed.");
	});

	it("rejects symlink sources and destination collisions", async () => {
		const outside = join(directory, "outside.mkv");
		await writeFile(outside, "outside");
		await symlink(outside, join(directory, "Library", "escape.mkv"));
		setup(["Library/escape.mkv"]);
		await expect(service.createPlan("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000099")).rejects.toThrow(/symbolic links/i);

		await rm(join(directory, "Library", "escape.mkv"));
		await mkdir(join(directory, "Library", "A"));
		await mkdir(join(directory, "Library", "B"));
		await writeFile(join(directory, "Library", "A", "Film.mkv"), "a");
		await writeFile(join(directory, "Library", "B", "Film.mkv"), "b");
		setup(["Library/A/Film.mkv", "Library/B/Film.mkv"]);
		await expect(service.createPlan("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000099")).rejects.toThrow(/same destination/i);

		await rm(join(directory, "Library", "A"), { recursive: true });
		await rm(join(directory, "Library", "B"), { recursive: true });
		await mkdir(join(directory, "Library", "film (2024)"), { recursive: true });
		await writeFile(join(directory, "Library", "Film.mkv"), "source");
		await writeFile(join(directory, "Library", "film (2024)", "Film.mkv"), "existing");
		setup(["Library/Film.mkv"]);
		await expect(service.createPlan("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000099")).rejects.toThrow(/case-insensitive filesystem/i);
	});

	it("keeps execution disabled by default, then executes and reverses an explicitly confirmed plan", async () => {
		await writeFile(join(directory, "Library", "Film.mkv"), "film-bytes");
		setup(["Library/Film.mkv"]);
		const libraryId = "00000000-0000-4000-8000-000000000001";
		const actorId = "00000000-0000-4000-8000-000000000099";
		const plan = await service.createPlan(libraryId, actorId);
		const before = await service.reconcilePlan(libraryId, plan.id, 0, 10);
		expect(before.counts.notMoved).toBe(1);
		expect(before.counts.moved).toBe(0);
		await expect(service.execute(libraryId, plan.id, actorId)).rejects.toThrow(/Enable organization writes for this library/);
		await expect(stat(join(directory, "Library", "Film.mkv"))).resolves.toBeDefined();

		await service.setWritePermissions(libraryId, { organizationWritesEnabled: true, nfoWritesEnabled: false });
		const executed = await service.execute(libraryId, plan.id, actorId);
		expect(executed.state).toBe("completed");
		expect(executed.audit?.map((entry) => entry.action)).toEqual(["preview_created", "execution_started", "executed"]);
		const target = join(directory, "Library", "Film (2024)", "Film.mkv");
		await expect(stat(target)).resolves.toBeDefined();
		const after = await service.reconcilePlan(libraryId, plan.id, 0, 10);
		expect(after.counts.moved).toBe(1);

		await service.setWritePermissions(libraryId, { organizationWritesEnabled: false, nfoWritesEnabled: false });
		await expect(service.rollback(libraryId, plan.id, actorId)).rejects.toThrow(/Enable organization writes for this library/);
		await expect(stat(target)).resolves.toBeDefined();
		await service.setWritePermissions(libraryId, { organizationWritesEnabled: true, nfoWritesEnabled: false });
		const rolledBack = await service.rollback(libraryId, plan.id, actorId);
		expect(rolledBack.state).toBe("rolled_back");
		expect(rolledBack.audit?.at(-1)?.action).toBe("rolled_back");
		await expect(stat(join(directory, "Library", "Film.mkv"))).resolves.toBeDefined();
	});

	it("refuses execution when a source changes after preview", async () => {
		const source = join(directory, "Library", "Film.mkv");
		await writeFile(source, "before preview");
		setup(["Library/Film.mkv"]);
		const libraryId = "00000000-0000-4000-8000-000000000001";
		const actorId = "00000000-0000-4000-8000-000000000099";
		const plan = await service.createPlan(libraryId, actorId);
		await service.setWritePermissions(libraryId, { organizationWritesEnabled: true, nfoWritesEnabled: false });
		await writeFile(source, "source changed after preview");

		await expect(service.execute(libraryId, plan.id, actorId)).rejects.toThrow(/changed after preview/);
		await expect(stat(source)).resolves.toBeDefined();
	});

	it("recovers an interrupted plan only when every file remains unmoved", async () => {
		const source = join(directory, "Library", "Film.mkv");
		await writeFile(source, "film-bytes");
		setup(["Library/Film.mkv"]);
		const libraryId = "00000000-0000-4000-8000-000000000001";
		const actorId = "00000000-0000-4000-8000-000000000099";
		const plan = await service.createPlan(libraryId, actorId);
		plan.state = "executing";
		plans[0] = plan;

		const recovered = await service.recoverUnmovedPlan(libraryId, plan.id, actorId);

		expect(recovered.state).toBe("failed");
		expect(recovered.error).toContain("before any files were moved");
		expect(recovered.audit?.at(-1)?.action).toBe("execution_interrupted_recovered");
		await expect(stat(source)).resolves.toBeDefined();
	});

	it("refuses to recover an executing plan if a source changed", async () => {
		const source = join(directory, "Library", "Film.mkv");
		await writeFile(source, "film-bytes");
		setup(["Library/Film.mkv"]);
		const libraryId = "00000000-0000-4000-8000-000000000001";
		const actorId = "00000000-0000-4000-8000-000000000099";
		const plan = await service.createPlan(libraryId, actorId);
		plan.state = "executing";
		plans[0] = plan;
		await writeFile(source, "changed bytes after preview");

		await expect(service.recoverUnmovedPlan(libraryId, plan.id, actorId)).rejects.toThrow(/cannot be safely reset/i);
		expect(plans[0]?.state).toBe("executing");
	});
});
