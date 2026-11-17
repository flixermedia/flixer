import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { lstat, link, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaLibrary, type MediaLibraryFolder } from "../../entities/mediaLibrary.entity.js";
import { MediaOrganizationPlan, MediaOrganizationPlanAudit, MediaOrganizationSettings } from "../../entities/mediaOrganization.entity.js";
import { MediaRootsService, parseRelativePath } from "../mediaLibraries/mediaRootsService.js";
import { DEFAULT_ORGANIZATION_TEMPLATES, rejectTargetCollisions, renderOrganizationTemplate, validateOrganizationTemplates, type OrganizationTemplates } from "./organizationPlanLogic.js";

const MAX_PLAN_ITEMS = 10_000;
const PLAN_HISTORY_SIZE = 50;

export interface OrganizationPlanMove {
	itemId: string;
	rootId: string;
	libraryFolder: string;
	type: "movie" | "episode" | "track";
	title: string;
	sourceRelativePath: string;
	targetRelativePath: string;
	sourceSizeBytes: number;
	sourceModifiedAt: string;
}

export interface OrganizationPlanSummary {
	moveCount: number;
	unchangedCount: number;
	totalBytes: number;
}

interface OrganizationPlanView extends MediaOrganizationPlan {
	audit: MediaOrganizationPlanAudit[];
}

type OrganizationMoveStatus = "notMoved" | "moved" | "bothExist" | "neitherExists" | "changed" | "unavailable";

interface OrganizationMoveReconciliation {
	itemId: string;
	title: string;
	sourceRelativePath: string;
	targetRelativePath: string;
	status: OrganizationMoveStatus;
}

function normalizedRelative(value: string): string {
	return parseRelativePath(value).join("/");
}

function isWithin(base: string, candidate: string): boolean {
	const rel = relative(base, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function metadataText(item: MediaItem | undefined, key: string): string | undefined {
	const value = item?.metadata?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataNumber(item: MediaItem, key: string): number | undefined {
	const value = item.metadata?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function libraryFolderFor(library: MediaLibrary, item: MediaItem): MediaLibraryFolder {
	if (!item.rootId || !item.relativePath) throw new BadRequest(`Item "${item.title}" has no indexed root path.`);
	const itemPath = normalizedRelative(item.relativePath);
	const candidates = library.folders
		.filter((folder) => {
			if (folder.rootId !== item.rootId) return false;
			const base = normalizedRelative(folder.path);
			return !base || itemPath.startsWith(`${base}/`);
		})
		.sort((a, b) => normalizedRelative(b.path).length - normalizedRelative(a.path).length);
	const folder = candidates[0];
	if (!folder) throw new BadRequest(`Item "${item.title}" is outside the configured library folders.`);
	return { rootId: folder.rootId, path: normalizedRelative(folder.path) };
}

function seriesFor(item: MediaItem, items: Map<string, MediaItem>): MediaItem | undefined {
	const season = item.parentId ? items.get(item.parentId) : undefined;
	return season?.parentId ? items.get(season.parentId) : undefined;
}

function targetFor(item: MediaItem, items: Map<string, MediaItem>, templates: OrganizationTemplates, filename: string): string | null {
	const series = seriesFor(item, items);
	const album = item.parentId ? items.get(item.parentId) : undefined;
	const values = {
		title: item.title || basename(filename),
		year: item.year ?? "Unknown",
		filename,
		seriesTitle: series?.title ?? "Unknown Series",
		seriesYear: series?.year ?? "Unknown",
		season: item.seasonNumber ?? "00",
		episode: item.episodeNumber ?? "00",
		artist: metadataText(item, "artist") ?? metadataText(item, "albumArtist") ?? metadataText(album, "artist") ?? metadataText(album, "albumArtist") ?? "Unknown Artist",
		album: metadataText(item, "album") ?? album?.title ?? "Unknown Album",
		trackNumber: metadataNumber(item, "trackNumber") ?? item.episodeNumber ?? "00",
		extension: filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "",
	};

	switch (item.type) {
		case "movie":
			return renderOrganizationTemplate(templates.movie, values);
		case "episode":
			return `${renderOrganizationTemplate(templates.series, values)}/${renderOrganizationTemplate(templates.episode, values)}`;
		case "track":
			return renderOrganizationTemplate(templates.music, values);
		default:
			return null;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function statFile(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function rejectExistingDestination(root: string, relativePath: string, title: string): Promise<void> {
	let current = root;
	const segments = parseRelativePath(relativePath);
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		const entries = await readdir(current).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		const exact = entries.find((entry) => entry === segment);
		if (!exact) {
			if (entries.some((entry) => entry.normalize("NFC").toLocaleLowerCase("en-US") === segment.normalize("NFC").toLocaleLowerCase("en-US"))) {
				throw new Conflict(`The destination for "${title}" collides with an existing path on a case-insensitive filesystem.`);
			}
			return;
		}
		current = join(current, exact);
		if (index === segments.length - 1) throw new Conflict(`The destination for "${title}" already exists.`);
		const info = await lstat(current);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new BadRequest("An organization destination parent is unsafe.");
	}
}

/** Walks a root-relative path without following symlinks and optionally creates missing directories. */
async function inspectPath(root: string, relativePath: string, options: { createDirectories?: boolean; file?: boolean } = {}): Promise<string> {
	const segments = parseRelativePath(relativePath);
	if (!segments.length) throw new BadRequest("An organization path cannot be the media root.");
	let current = root;
	for (let index = 0; index < segments.length; index += 1) {
		current = join(current, segments[index]);
		const final = index === segments.length - 1;
		let info;
		try {
			info = await lstat(current);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			if (options.createDirectories && !final) {
				await mkdir(current);
				info = await lstat(current);
			} else {
				return current;
			}
		}
		if (info.isSymbolicLink()) throw new BadRequest("Organization paths cannot contain symbolic links.");
		if (!final && !info.isDirectory()) throw new BadRequest("An organization path parent is not a directory.");
		if (final && options.file && !info.isFile()) throw new BadRequest("Only regular media files can be moved.");
	}
	const canonical = await realpath(current);
	if (!isWithin(root, canonical)) throw new BadRequest("Organization path is outside the media root.");
	return canonical;
}

async function createParentDirectories(root: string, relativePath: string): Promise<void> {
	const parent = dirname(relativePath);
	if (parent === ".") return;
	const segments = parseRelativePath(parent);
	let current = root;
	for (const segment of segments) {
		current = join(current, segment);
		if (await exists(current)) {
			const info = await lstat(current);
			if (info.isSymbolicLink() || !info.isDirectory()) throw new BadRequest("An organization destination parent is unsafe.");
		} else {
			await mkdir(current);
		}
		const canonical = await realpath(current);
		if (!isWithin(root, canonical)) throw new BadRequest("Organization destination is outside the media root.");
	}
}

async function moveWithoutOverwrite(source: string, target: string): Promise<void> {
	if (await exists(target)) throw new Conflict("An organization destination already exists.");
	await link(source, target);
	try {
		await unlink(source);
	} catch (error) {
		await unlink(target).catch(() => undefined);
		throw error;
	}
}

@Injectable()
export class MediaOrganizationService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly roots: MediaRootsService,
	) {}

	async settings(libraryId: string) {
		await this.requireLibrary(libraryId);
		const settings = await this.dataSource.getRepository(MediaOrganizationSettings).findOneBy({ libraryId });
		return {
			organizationWritesEnabled: settings?.organizationWritesEnabled ?? false,
			nfoWritesEnabled: settings?.nfoWritesEnabled ?? false,
			templates: settings?.templates ?? DEFAULT_ORGANIZATION_TEMPLATES,
			plans: await this.list(libraryId),
		};
	}

	async setWritePermissions(libraryId: string, input: { organizationWritesEnabled: unknown; nfoWritesEnabled: unknown }) {
		await this.requireLibrary(libraryId);
		if (typeof input?.organizationWritesEnabled !== "boolean" || typeof input?.nfoWritesEnabled !== "boolean") {
			throw new BadRequest("Write permissions must be booleans.");
		}
		const repository = this.dataSource.getRepository(MediaOrganizationSettings);
		const current = await repository.findOneBy({ libraryId });
		const saved = await repository.save({
			libraryId,
			templates: current?.templates ?? DEFAULT_ORGANIZATION_TEMPLATES,
			organizationWritesEnabled: input.organizationWritesEnabled,
			nfoWritesEnabled: input.nfoWritesEnabled,
		});
		return {
			organizationWritesEnabled: saved.organizationWritesEnabled,
			nfoWritesEnabled: saved.nfoWritesEnabled,
		};
	}

	async saveTemplates(libraryId: string, input: unknown, actorId: string) {
		await this.requireLibrary(libraryId);
		const templates = validateOrganizationTemplates(input);
		await this.dataSource.getRepository(MediaOrganizationSettings).save({ libraryId, templates });
		return templates;
	}

	async list(libraryId: string): Promise<MediaOrganizationPlan[]> {
		await this.requireLibrary(libraryId);
		return this.dataSource.getRepository(MediaOrganizationPlan).find({ where: { libraryId }, order: { createdAt: "DESC" }, take: PLAN_HISTORY_SIZE });
	}

	async get(libraryId: string, planId: string): Promise<OrganizationPlanView> {
		const plan = await this.dataSource.getRepository(MediaOrganizationPlan).findOneBy({ id: planId, libraryId });
		if (!plan) throw new NotFound("Organization plan not found.");
		const audit = await this.dataSource.getRepository(MediaOrganizationPlanAudit).find({ where: { planId }, order: { createdAt: "ASC" } });
		return { ...plan, audit };
	}

	async reconcilePlan(libraryId: string, planId: string, offset = 0, limit = 100) {
		const plan = await this.requirePlan(libraryId, planId);
		if (!Number.isInteger(offset) || offset < 0 || offset > MAX_PLAN_ITEMS || !Number.isInteger(limit) || limit < 1 || limit > 100) {
			throw new BadRequest("Reconciliation offset or page size is invalid.");
		}
		const moves = plan.moves.slice(offset, offset + limit);
		const results: OrganizationMoveReconciliation[] = [];
		const counts: Record<OrganizationMoveStatus, number> = { notMoved: 0, moved: 0, bothExist: 0, neitherExists: 0, changed: 0, unavailable: 0 };
		for (const move of moves) {
			try {
				const { root, source, target } = await this.resolveMovePaths(move);
				const [sourceInfo, targetInfo] = await Promise.all([statFile(source), statFile(target)]);
				const sourceMatches = sourceInfo?.isFile() === true && sourceInfo.size === move.sourceSizeBytes && sourceInfo.mtime.toISOString() === move.sourceModifiedAt;
				const targetMatches = targetInfo?.isFile() === true && targetInfo.size === move.sourceSizeBytes && targetInfo.mtime.toISOString() === move.sourceModifiedAt;
				let status: OrganizationMoveStatus;
				if (sourceMatches && !targetInfo) status = "notMoved";
				else if (!sourceInfo && targetMatches) status = "moved";
				else if (sourceInfo && targetInfo) status = "bothExist";
				else if (!sourceInfo && !targetInfo) status = "neitherExists";
				else status = "changed";
				if (!isWithin(root, source) || !isWithin(root, target)) status = "unavailable";
				counts[status] += 1;
				results.push({ itemId: move.itemId, title: move.title, sourceRelativePath: move.sourceRelativePath, targetRelativePath: move.targetRelativePath, status });
			} catch {
				counts.unavailable += 1;
				results.push({ itemId: move.itemId, title: move.title, sourceRelativePath: move.sourceRelativePath, targetRelativePath: move.targetRelativePath, status: "unavailable" });
			}
		}
		return { planId, state: plan.state, total: plan.moves.length, offset, limit, nextOffset: offset + results.length < plan.moves.length ? offset + results.length : null, scanned: results.length, counts, items: results };
	}

	async createPlan(libraryId: string, actorId: string): Promise<MediaOrganizationPlan> {
		const library = await this.requireLibrary(libraryId);
		const stored = await this.dataSource.getRepository(MediaOrganizationSettings).findOneBy({ libraryId });
		const templates = validateOrganizationTemplates(stored?.templates ?? DEFAULT_ORGANIZATION_TEMPLATES);
		const items = await this.dataSource.getRepository(MediaItem).find({ where: { libraryId, isPlaceholder: false }, order: { path: "ASC" }, take: MAX_PLAN_ITEMS + 1 });
		if (items.length > MAX_PLAN_ITEMS) throw new BadRequest(`Organization plans are limited to ${MAX_PLAN_ITEMS} items.`);
		const itemMap = new Map(items.map((item) => [item.id, item]));
		const moves: OrganizationPlanMove[] = [];
		let unchangedCount = 0;
		let totalBytes = 0;
		for (const item of items) {
			if (item.type !== "movie" && item.type !== "episode" && item.type !== "track") continue;
			const rootId = item.rootId;
			const sourceRelativePath = normalizedRelative(item.relativePath ?? "");
			if (!rootId || !sourceRelativePath || !isAbsolute(item.path)) throw new BadRequest(`Item "${item.title}" has an incomplete indexed path.`);
			const folder = libraryFolderFor(library, item);
			const folderPath = normalizedRelative(folder.path);
			const targetWithinFolder = targetFor(item, itemMap, templates, basename(sourceRelativePath));
			if (!targetWithinFolder) continue;
			const targetRelativePath = normalizedRelative(folderPath ? `${folderPath}/${targetWithinFolder}` : targetWithinFolder);
			const rootPath = this.roots.get(rootId).path;
			if (!isWithin(resolve(rootPath, folderPath), resolve(rootPath, targetRelativePath))) {
				throw new BadRequest(`The destination for "${item.title}" is outside its library folder.`);
			}
			const root = await realpath(rootPath);
			const base = folderPath ? await inspectPath(root, folderPath) : root;
			const source = await inspectPath(root, sourceRelativePath, { file: true });
			if (!isWithin(base, source)) throw new BadRequest(`The source for "${item.title}" is outside its library folder.`);
			if (resolve(item.path) !== source) throw new Conflict(`The indexed path for "${item.title}" has changed; rescan the library and preview again.`);
			if (sourceRelativePath === targetRelativePath) {
				unchangedCount += 1;
				continue;
			}
			const sourceInfo = await lstat(source);
			moves.push({
				itemId: item.id, rootId, libraryFolder: folderPath, type: item.type, title: item.title,
				sourceRelativePath, targetRelativePath, sourceSizeBytes: sourceInfo.size, sourceModifiedAt: sourceInfo.mtime.toISOString(),
			});
			totalBytes += Number(sourceInfo.size);
		}
		if (moves.length === 0) throw new BadRequest("No media files need organization.");
		rejectTargetCollisions(moves);
		for (const move of moves) {
			const root = await realpath(this.roots.get(move.rootId).path);
			const base = move.libraryFolder ? await inspectPath(root, move.libraryFolder) : root;
			await inspectPath(root, move.targetRelativePath);
			const target = join(root, move.targetRelativePath);
			if (!isWithin(base, target)) throw new BadRequest("An organization destination is outside its library folder.");
			await rejectExistingDestination(root, move.targetRelativePath, move.title);
		}
		const plan = this.dataSource.getRepository(MediaOrganizationPlan).create({
			id: randomUUID(),
			libraryId,
			state: "preview",
			templates,
			moves,
			summary: { moveCount: moves.length, unchangedCount, totalBytes },
			createdBy: actorId,
			error: null,
			executedAt: null,
			rolledBackAt: null,
		});
		const saved = await this.dataSource.getRepository(MediaOrganizationPlan).save(plan);
		await this.audit(saved.id, actorId, "preview_created", { ...saved.summary });
		return saved;
	}

	async execute(libraryId: string, planId: string, actorId: string): Promise<OrganizationPlanView> {
		const plan = await this.requirePlan(libraryId, planId);
		if (!(await this.organizationWritesEnabled(libraryId))) throw new BadRequest("Enable organization writes for this library in Flixer Web and ensure the media mount is writable.");
		if (plan.state === "executing") throw new Conflict("This plan is already being executed. Reload its status before retrying.");
		if (plan.state !== "preview") throw new Conflict("Only a preview plan can be executed.");
		await this.requirePlanSourcesCurrent(plan);
		await this.claimStateWithAudit(plan, "preview", "executing", actorId, "execution_started", { requestedMoves: plan.moves.length });
		plan.state = "executing";
		const moved: OrganizationPlanMove[] = [];
		try {
			for (const move of plan.moves) {
				const { root, source, target } = await this.resolveMovePaths(move);
				await inspectPath(root, move.sourceRelativePath, { file: true });
				await createParentDirectories(root, move.targetRelativePath);
				const targetParent = dirname(move.targetRelativePath);
				if (targetParent !== ".") await inspectPath(root, targetParent);
				await moveWithoutOverwrite(source, target);
				moved.push(move);
			}
			plan.state = "completed";
			plan.executedAt = new Date();
			plan.error = null;
			await this.dataSource.getRepository(MediaOrganizationPlan).save(plan);
			await this.audit(plan.id, actorId, "executed", { moved: moved.length });
		} catch (error) {
			const rollbackErrors: string[] = [];
			for (const move of [...moved].reverse()) {
				try {
					await this.inverseMove(move);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
				}
			}
			plan.state = "failed";
			plan.error = [error instanceof Error ? error.message : String(error), ...rollbackErrors].join("; rollback: ");
			await this.dataSource.getRepository(MediaOrganizationPlan).save(plan);
			await this.audit(plan.id, actorId, "execution_failed", { error: plan.error, reverted: moved.length - rollbackErrors.length, rollbackErrors });
			throw error;
		}
		return this.get(libraryId, planId);
	}

	async recoverUnmovedPlan(libraryId: string, planId: string, actorId: string): Promise<OrganizationPlanView> {
		const plan = await this.requirePlan(libraryId, planId);
		if (plan.state !== "executing") throw new Conflict("Only a plan stuck in executing state can be recovered.");
		const counts: Record<OrganizationMoveStatus, number> = { notMoved: 0, moved: 0, bothExist: 0, neitherExists: 0, changed: 0, unavailable: 0 };
		for (let offset = 0; offset < plan.moves.length; offset += 100) {
			const page = await this.reconcilePlan(libraryId, planId, offset, 100);
			for (const status of Object.keys(counts) as OrganizationMoveStatus[]) counts[status] += page.counts[status];
		}
		if (counts.notMoved !== plan.moves.length || counts.moved + counts.bothExist + counts.neitherExists + counts.changed + counts.unavailable > 0) {
			throw new Conflict("The plan has file changes or unavailable paths; it cannot be safely reset. Review the read-only reconciliation before continuing.");
		}
		const error = "Execution was interrupted before any files were moved. All planned source files remain in place; create a fresh preview to retry.";
		await this.claimStateWithAudit(plan, "executing", "failed", actorId, "execution_interrupted_recovered", { notMoved: counts.notMoved }, error);
		plan.state = "failed";
		plan.error = error;
		return this.get(libraryId, planId);
	}

	async rollback(libraryId: string, planId: string, actorId: string): Promise<OrganizationPlanView> {
		const plan = await this.requirePlan(libraryId, planId);
		if (!(await this.organizationWritesEnabled(libraryId))) throw new BadRequest("Enable organization writes for this library in Flixer Web and ensure the media mount is writable.");
		if (plan.state !== "completed") throw new Conflict("Only a completed plan can be rolled back.");
		await this.claimStateWithAudit(plan, "completed", "rolling_back", actorId, "rollback_started", { requestedMoves: plan.moves.length });
		plan.state = "rolling_back";
		const reverted: OrganizationPlanMove[] = [];
		try {
			for (const move of [...plan.moves].reverse()) {
				await this.inverseMove(move);
				reverted.push(move);
			}
			plan.state = "rolled_back";
			plan.rolledBackAt = new Date();
			plan.error = null;
			await this.dataSource.getRepository(MediaOrganizationPlan).save(plan);
			await this.audit(plan.id, actorId, "rolled_back", { moved: reverted.length });
		} catch (error) {
			const recoveryErrors: string[] = [];
			for (const move of [...reverted].reverse()) {
				try {
					const { root, source, target } = await this.resolveMovePaths(move);
					await createParentDirectories(root, move.sourceRelativePath);
					await inspectPath(root, dirname(move.targetRelativePath) === "." ? move.libraryFolder : dirname(move.targetRelativePath));
					await moveWithoutOverwrite(source, target);
				} catch (recoveryError) {
					recoveryErrors.push(recoveryError instanceof Error ? recoveryError.message : String(recoveryError));
				}
			}
			plan.state = "rollback_failed";
			plan.error = [error instanceof Error ? error.message : String(error), ...recoveryErrors].join("; recovery: ");
			await this.dataSource.getRepository(MediaOrganizationPlan).save(plan);
			await this.audit(plan.id, actorId, "rollback_failed", { error: plan.error, restored: reverted.length - recoveryErrors.length });
			throw error;
		}
		return this.get(libraryId, planId);
	}

	async remove(libraryId: string, planId: string, actorId: string): Promise<void> {
		const plan = await this.requirePlan(libraryId, planId);
		if (plan.state !== "preview") throw new Conflict("Only an unexecuted preview plan can be discarded.");
		plan.state = "discarded";
		await this.dataSource.getRepository(MediaOrganizationPlan).save(plan);
		await this.audit(plan.id, actorId, "preview_discarded", {});
	}

	private async requireLibrary(libraryId: string): Promise<MediaLibrary> {
		const library = await this.dataSource.getRepository(MediaLibrary).findOneBy({ id: libraryId });
		if (!library) throw new NotFound("Media library not found.");
		return library;
	}

	private async requirePlan(libraryId: string, planId: string): Promise<MediaOrganizationPlan> {
		const plan = await this.dataSource.getRepository(MediaOrganizationPlan).findOneBy({ id: planId, libraryId });
		if (!plan) throw new NotFound("Organization plan not found.");
		return plan;
	}

	private async organizationWritesEnabled(libraryId: string): Promise<boolean> {
		const settings = await this.dataSource.getRepository(MediaOrganizationSettings).findOneBy({ libraryId });
		return settings?.organizationWritesEnabled === true;
	}

	private async claimStateWithAudit(plan: MediaOrganizationPlan, expected: string, next: string, actorId: string, action: string, details: Record<string, unknown>, error: string | null = null): Promise<void> {
		const rows = await this.dataSource.query<Array<{ id: string }>>(
			'WITH claimed AS (UPDATE "media_organization_plans" SET "state" = $1, "error" = $2, "updated_at" = now() WHERE "id" = $3 AND "library_id" = $4 AND "state" = $5 RETURNING "id") INSERT INTO "media_organization_plan_audit" ("id", "plan_id", "actor_id", "action", "details") SELECT $6, "id", $7, $8, $9::jsonb FROM claimed RETURNING "plan_id" AS "id"',
			[next, error, plan.id, plan.libraryId, expected, randomUUID(), actorId, action, JSON.stringify(details)],
		);
		if (rows.length !== 1) throw new Conflict("This organization plan has already changed state.");
	}

	private async audit(planId: string, actorId: string, action: string, details: Record<string, unknown>): Promise<void> {
		await this.dataSource.getRepository(MediaOrganizationPlanAudit).save({ id: randomUUID(), planId, actorId, action, details });
	}

	private async requirePlanSourcesCurrent(plan: MediaOrganizationPlan): Promise<void> {
		const itemIds = plan.moves.map((move) => move.itemId);
		const current = await this.dataSource.getRepository(MediaItem).find({ where: { id: In(itemIds) } });
		const byId = new Map(current.map((item) => [item.id, item]));
		for (const move of plan.moves) {
			const item = byId.get(move.itemId);
			if (!item || item.rootId !== move.rootId || normalizedRelative(item.relativePath ?? "") !== move.sourceRelativePath || resolve(item.path) !== resolve(this.roots.get(move.rootId).path, move.sourceRelativePath)) {
				throw new Conflict(`The indexed path for "${move.title}" changed; rescan and create a fresh preview.`);
			}
			const { source } = await this.resolveMovePaths(move);
			const info = await lstat(source);
			if (!info.isFile() || info.size !== move.sourceSizeBytes || info.mtime.toISOString() !== move.sourceModifiedAt) {
				throw new Conflict(`The source file for "${move.title}" changed after preview; create a fresh preview.`);
			}
		}
	}

	private async resolveMovePaths(move: OrganizationPlanMove): Promise<{ root: string; source: string; target: string }> {
		const root = await realpath(this.roots.get(move.rootId).path);
		const libraryFolder = normalizedRelative(move.libraryFolder);
		const sourceRelativePath = normalizedRelative(move.sourceRelativePath);
		const targetRelativePath = normalizedRelative(move.targetRelativePath);
		const base = libraryFolder ? await inspectPath(root, libraryFolder) : root;
		const source = join(root, sourceRelativePath);
		const target = join(root, targetRelativePath);
		if (!isWithin(base, source) || !isWithin(base, target)) throw new BadRequest("An organization operation is outside its library folder.");
		for (const path of [sourceRelativePath, targetRelativePath]) {
			const parent = dirname(path);
			if (parent !== ".") await inspectPath(root, parent);
		}
		return { root, source, target };
	}

	private async inverseMove(move: OrganizationPlanMove): Promise<void> {
		const { root, source, target } = await this.resolveMovePaths(move);
		if ((await exists(source)) || !(await exists(target))) throw new Conflict(`Cannot safely reverse the move for "${move.title}".`);
		await inspectPath(root, move.targetRelativePath, { file: true });
		await createParentDirectories(root, move.sourceRelativePath);
		await moveWithoutOverwrite(target, source);
	}
}
