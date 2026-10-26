import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { Inject, Injectable, logger } from "@tsed/di";
import { createHash, timingSafeEqual } from "node:crypto";
import { rename, rm, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataPath } from "../../config/dataPath.js";
import { version as flixerVersion } from "../../config/config.js";
import semver from "semver";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { PluginRepository } from "../../entities/pluginRepository.entity.js";
import { PluginUpdateHistory } from "../../entities/pluginUpdateHistory.entity.js";
import { IndexerClient, type IndexerPluginStatus } from "../indexer/indexerClient.js";
import { fetchPluginRepositoryArtifact, fetchPluginRepositoryManifest } from "./pluginRepositoryClient.js";
import { parsePluginManifest, type PluginManifest } from "./pluginManifest.js";
import { pluginCatalogMatchesManifest } from "./repositoryManifest.js";
import { installPluginPackageAtomically } from "./pluginPackageInstaller.js";
import { normalizePluginRepositoryUrl } from "./pluginRepositoryUrl.js";

const OFFICIAL_REPOSITORY_URL = "https://raw.githubusercontent.com/flixermedia/flixer-plugins/main/repository.json";
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PLUGIN_TARGETS = ["flixer", "flixer-indexer", "flixer-streamer", "flixer-web"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function pluginUpdateErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : "Plugin installation failed.";
	return message
		.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/([?&](?:token|key|secret|password|api[_-]?key)=)[^&\s]*/gi, "$1[redacted]")
		.slice(0, 1000);
}

export function preservePluginInstallationState(
	existing: Pick<PluginInstallation, "settings" | "encryptedSecrets" | "approvedPermissions"> | null,
	manifest: PluginManifest,
	requestedPermissions: Iterable<string>,
): Pick<PluginInstallation, "settings" | "encryptedSecrets" | "approvedPermissions"> {
	const requested = new Set(requestedPermissions);
	const previouslyApproved = new Set(existing?.approvedPermissions ?? []);
	return {
		settings: { ...(existing?.settings ?? {}) },
		encryptedSecrets: { ...(existing?.encryptedSecrets ?? {}) },
		approvedPermissions: manifest.permissions.filter(
			(permission) => requested.has(permission) || previouslyApproved.has(permission),
		),
	};
}

export interface PluginCatalogFilter {
	query?: string;
	target?: string;
	capability?: string;
}

export interface AddPluginRepositoryRequest {
	name: string;
	url: string;
}

export interface InstallPluginRequest {
	repositoryId: string;
	version: string;
	approvedPermissions: string[];
}

@Injectable()
export class PluginManagerService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly indexer: IndexerClient,
	) {}

	private refreshTimer?: ReturnType<typeof setInterval>;
	private healthTimer?: ReturnType<typeof setInterval>;

	$onReady(): void {
		const refresh = () =>
			void this.refreshEnabledRepositories().catch((error: unknown) =>
				logger().error("Plugin repository refresh failed.", error),
			);
		refresh();
		this.refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
		this.refreshTimer.unref?.();
		const refreshHealth = () =>
			void this.refreshPluginHealth().catch((error: unknown) =>
				logger().warn("Could not refresh plugin health.", error),
			);
		refreshHealth();
		this.healthTimer = setInterval(refreshHealth, 30_000);
		this.healthTimer.unref?.();
	}

	$onDestroy(): void {
		clearInterval(this.refreshTimer);
		clearInterval(this.healthTimer);
	}

	/** Settings pages contributed by enabled plugins that ship a settings schema. */
	async adminPages() {
		const installations = await this.dataSource
			.getRepository(PluginInstallation)
			.find({ where: { enabled: true }, order: { pluginId: "ASC" } });
		return installations.flatMap((installation) =>
			installation.manifest.settingsSchema
				? (installation.manifest.ui?.adminPages ?? []).map((page) => ({
						pluginId: installation.pluginId,
						pluginName: installation.manifest.name,
						...page,
					}))
				: [],
		);
	}

	async listInstalled() {
		const installations = await this.dataSource
			.getRepository(PluginInstallation)
			.find({ order: { pluginId: "ASC" } });
		const repositoryIds = [
			...new Set(
				installations
					.map((installation) => installation.repositoryId)
					.filter((id): id is string => id !== null),
			),
		];
		const sources =
			repositoryIds.length > 0
				? await this.dataSource.getRepository(PluginRepository).findBy({ id: In(repositoryIds) })
				: [];
		const sourceById = new Map(sources.map((source) => [source.id, source]));
		return installations.map((installation) => {
			const activationReason = this.activationProblem(installation.manifest);
			const source = installation.repositoryId ? sourceById.get(installation.repositoryId) : undefined;
			const catalogEntry = source?.manifest?.plugins.find((plugin) => plugin.id === installation.pluginId);
			const newerReleases = (catalogEntry?.versions ?? [])
				.map((release) => release.version)
				.filter((version) => semver.gt(version, installation.version))
				.sort(semver.rcompare);
			return {
				id: installation.pluginId,
				version: installation.version,
				status: installation.status,
				enabled: installation.enabled,
				approvedPermissions: installation.approvedPermissions,
				activationSupported: activationReason === null,
				activationReason,
				targetStatus: installation.targetStatus,
				lastError: installation.lastError,
				manifest: installation.manifest,
				repository: source ? { id: source.id, name: source.name, isOfficial: source.isOfficial } : null,
				availableUpdate: newerReleases[0]
					? { version: newerReleases[0], permissions: catalogEntry?.permissions ?? [] }
					: null,
				installedAt: installation.installedAt,
				updatedAt: installation.updatedAt,
			};
		});
	}

	async enable(pluginId: string): Promise<PluginInstallation> {
		const installations = this.dataSource.getRepository(PluginInstallation);
		const installation = await installations.findOneBy({ pluginId });
		if (!installation) throw new NotFound("Installed plugin not found.");
		const problem = this.activationProblem(installation.manifest);
		if (problem) throw new BadRequest(problem);
		const unapproved = installation.manifest.permissions.filter(
			(permission) => !installation.approvedPermissions.includes(permission),
		);
		if (unapproved.length > 0)
			throw new BadRequest(`Permission approval is missing for: ${unapproved.join(", ")}.`);
		await this.requireDependencies(installation.manifest);
		installation.enabled = true;
		installation.status = "enabled";
		installation.lastError = null;
		installation.targetStatus = Object.fromEntries(
			Object.keys(installation.manifest.targets).map((target) => [target, "requested"]),
		);
		const saved = await installations.save(installation);
		await this.indexer.reloadSettings();
		await this.refreshPluginHealth();
		return saved;
	}

	async disable(pluginId: string): Promise<PluginInstallation> {
		const installations = this.dataSource.getRepository(PluginInstallation);
		const installation = await installations.findOneBy({ pluginId });
		if (!installation) throw new NotFound("Installed plugin not found.");
		const dependents = (await installations.find({ where: { enabled: true } }))
			.filter((candidate) => candidate.manifest.dependencies?.[pluginId] !== undefined)
			.map((candidate) => candidate.pluginId);
		if (dependents.length > 0) throw new Conflict(`Disable dependent plugins first: ${dependents.join(", ")}.`);
		installation.enabled = false;
		installation.status = "disabled";
		installation.targetStatus = Object.fromEntries(
			Object.keys(installation.manifest.targets).map((target) => [target, "disabled"]),
		);
		const saved = await installations.save(installation);
		await this.indexer.reloadSettings();
		return saved;
	}

	async uninstall(pluginId: string): Promise<void> {
		const installations = this.dataSource.getRepository(PluginInstallation);
		const installation = await installations.findOneBy({ pluginId });
		if (!installation) throw new NotFound("Installed plugin not found.");
		if (installation.enabled) throw new BadRequest("Disable the plugin before uninstalling it.");
		const dependents = (await installations.find())
			.filter((candidate) => candidate.manifest.dependencies?.[pluginId] !== undefined)
			.map((candidate) => candidate.pluginId);
		if (dependents.length > 0) throw new Conflict(`Uninstall dependent plugins first: ${dependents.join(", ")}.`);

		const installedRoot = dataPath("plugins", "installed");
		const pluginPath = join(installedRoot, pluginId);
		const temporaryRoot = dataPath("plugins", "temp");
		await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
		const retainedPackage = join(temporaryRoot, `uninstall-${pluginId}-${Date.now()}`);
		let moved = false;
		try {
			await stat(pluginPath);
			await rename(pluginPath, retainedPackage);
			moved = true;
		} catch (error: unknown) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		try {
			await installations.remove(installation);
		} catch (error: unknown) {
			if (moved) await rename(retainedPackage, pluginPath);
			throw error;
		}
		if (moved) await rm(retainedPackage, { recursive: true, force: true });
	}

	async listRepositories() {
		return this.dataSource.getRepository(PluginRepository).find({
			order: { isOfficial: "DESC", name: "ASC" },
		});
	}

	async discover(filter: PluginCatalogFilter = {}) {
		const target = filter.target?.trim();
		if (target && !(PLUGIN_TARGETS as readonly string[]).includes(target)) {
			throw new BadRequest(`target must be one of ${PLUGIN_TARGETS.join(", ")}.`);
		}
		const query = filter.query?.trim().toLowerCase() ?? "";
		const capability = filter.capability?.trim().toLowerCase() ?? "";
		const repositories = await this.dataSource.getRepository(PluginRepository).find({ where: { enabled: true } });

		return repositories.flatMap((repository) =>
			(repository.manifest?.plugins ?? [])
				.filter((plugin) => {
					const searchable =
						`${plugin.id} ${plugin.name} ${plugin.description} ${plugin.author}`.toLowerCase();
					return (
						(!query || searchable.includes(query)) &&
						(!target || plugin.targets.includes(target as (typeof PLUGIN_TARGETS)[number])) &&
						(!capability ||
							(plugin.capabilities ?? []).some((item) => item.toLowerCase().includes(capability)))
					);
				})
				.map((plugin) => ({
					...plugin,
					repository: {
						id: repository.id,
						name: repository.name,
						url: repository.url,
						isOfficial: repository.isOfficial,
					},
				})),
		);
	}

	async install(pluginId: string, request: InstallPluginRequest) {
		if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId)) throw new NotFound("Plugin release not found.");
		if (!request?.repositoryId || !semver.valid(request.version))
			throw new BadRequest("A repository ID and exact semantic version are required.");
		if (
			request.approvedPermissions !== undefined &&
			(!Array.isArray(request.approvedPermissions) ||
				!request.approvedPermissions.every((permission) => typeof permission === "string"))
		) {
			throw new BadRequest("Approved permissions must be a list of permission identifiers.");
		}

		const installations = this.dataSource.getRepository(PluginInstallation);
		const existing = await installations.findOneBy({ pluginId });
		try {
			return await this.installRelease(pluginId, request, existing);
		} catch (error: unknown) {
			await this.recordUpdateHistorySafely({
				pluginId,
				action: existing ? "update" : "install",
				fromVersion: existing?.version ?? null,
				toVersion: request.version,
				outcome: "failed",
				errorMessage: pluginUpdateErrorMessage(error),
			});
			throw error;
		}
	}

	async updateHistory(pluginId: string, limit = 20): Promise<PluginUpdateHistory[]> {
		if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId)) {
			throw new NotFound("Plugin installation not found.");
		}
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
			throw new BadRequest("History limit must be an integer between 1 and 100.");
		}
		return this.dataSource.getRepository(PluginUpdateHistory).find({
			where: { pluginId },
			order: { createdAt: "DESC" },
			take: limit,
		});
	}

	private async installRelease(pluginId: string, request: InstallPluginRequest, existing: PluginInstallation | null) {
		const repositories = this.dataSource.getRepository(PluginRepository);
		const source = await repositories.findOneBy({ id: request.repositoryId, enabled: true });
		if (!source?.manifest) throw new NotFound("Enabled plugin repository not found.");
		const catalogPlugin = source.manifest.plugins.find((plugin) => plugin.id === pluginId);
		const release = catalogPlugin?.versions.find((candidate) => candidate.version === request.version);
		if (!catalogPlugin || !release) throw new NotFound("Plugin release not found in this repository.");

		if (existing?.enabled) throw new Conflict("Disable this plugin before updating its installed package.");

		let releaseManifest;
		try {
			const manifestBytes = await fetchPluginRepositoryArtifact(source.url, release.manifest, 1_048_576);
			releaseManifest = parsePluginManifest(JSON.parse(manifestBytes.toString("utf8")) as unknown);
		} catch (error: unknown) {
			throw new BadRequest(
				`Plugin release manifest is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
			);
		}
		if (releaseManifest.id !== pluginId || releaseManifest.version !== request.version) {
			throw new BadRequest("Plugin release manifest does not match the selected catalog entry.");
		}
		if (!pluginCatalogMatchesManifest(catalogPlugin, releaseManifest)) {
			throw new BadRequest("Plugin release metadata does not match the repository catalog.");
		}
		const approvedPermissions = new Set(request.approvedPermissions ?? []);
		const unapproved = releaseManifest.permissions.filter((permission) => !approvedPermissions.has(permission));
		if (unapproved.length > 0) {
			throw new BadRequest(
				`Administrator approval is required for plugin permissions: ${unapproved.join(", ")}.`,
			);
		}
		this.requireCompatible(releaseManifest);
		await this.requireDependencies(releaseManifest);

		const archive = await fetchPluginRepositoryArtifact(source.url, release.package, 104_857_600);
		if (release.size !== undefined && archive.length !== release.size) {
			throw new BadRequest("Plugin package size does not match the repository catalog.");
		}
		const digest = createHash("sha256").update(archive).digest();
		const expectedDigest = Buffer.from(release.sha256, "hex");
		if (expectedDigest.length !== digest.length || !timingSafeEqual(digest, expectedDigest)) {
			throw new BadRequest("Plugin package SHA-256 digest does not match the repository catalog.");
		}

		const installed = await installPluginPackageAtomically(
			dataPath("plugins"),
			archive,
			releaseManifest,
			release.sha256,
			async (result) => {
				await this.dataSource.transaction(async (manager) => {
					const preservedState = preservePluginInstallationState(
						existing,
						result.manifest,
						approvedPermissions,
					);
					const installation = manager.getRepository(PluginInstallation).create({
						pluginId: result.pluginId,
						repositoryId: source.id,
						version: result.version,
						packageDigest: result.packageDigest,
						installPath: result.installPath,
						manifest: result.manifest,
						status: "disabled",
						enabled: false,
						...preservedState,
						targetStatus: Object.fromEntries(
							Object.keys(result.manifest.targets).map((target) => [target, "installed"]),
						),
						lastError: null,
					});
					await manager.getRepository(PluginInstallation).save(installation);
					await manager.getRepository(PluginUpdateHistory).save({
						pluginId,
						action: existing ? "update" : "install",
						fromVersion: existing?.version ?? null,
						toVersion: result.version,
						outcome: "succeeded",
						errorMessage: null,
					});
				});
			},
		);
		const persisted = await this.dataSource
			.getRepository(PluginInstallation)
			.findOneBy({ pluginId: installed.pluginId });
		if (!persisted) throw new Error("Plugin package was installed but its metadata record could not be loaded.");
		return persisted;
	}

	private async recordUpdateHistorySafely(
		entry: Pick<
			PluginUpdateHistory,
			"pluginId" | "action" | "fromVersion" | "toVersion" | "outcome" | "errorMessage"
		>,
	): Promise<void> {
		try {
			await this.dataSource.getRepository(PluginUpdateHistory).save(entry);
		} catch (historyError: unknown) {
			logger().error(`Could not record ${entry.action} history for plugin ${entry.pluginId}.`, historyError);
		}
	}

	private requireCompatible(manifest: ReturnType<typeof parsePluginManifest>): void {
		if (
			!semver.validRange(manifest.compatibility.pluginApi) ||
			!semver.satisfies("1.0.0", manifest.compatibility.pluginApi)
		) {
			throw new BadRequest("Plugin requires an unsupported plugin API version.");
		}
		if (manifest.compatibility.flixer && !semver.satisfies(flixerVersion, manifest.compatibility.flixer)) {
			throw new BadRequest(`Plugin is not compatible with Flixer ${flixerVersion}.`);
		}
	}

	private activationProblem(manifest: ReturnType<typeof parsePluginManifest>): string | null {
		try {
			this.requireCompatible(manifest);
		} catch (error: unknown) {
			return error instanceof Error ? error.message : "Plugin compatibility could not be verified.";
		}
		const targets = Object.entries(manifest.targets);
		const unsupportedTargets = targets
			.map(([target]) => target)
			.filter((target) => target !== "flixer" && target !== "flixer-indexer");
		if (unsupportedTargets.length > 0) {
			return `Runtime support is not available for: ${unsupportedTargets.join(", ")}.`;
		}
		const backend = manifest.targets.flixer;
		if (backend) {
			if (!backend.entry.toLowerCase().endsWith(".wasm")) {
				return "Backend plugins must use a WASI .wasm entry point.";
			}
			if (
				!manifest.capabilities.some(
					(capability) => capability === "api.routes" || capability === "backend.routes",
				)
			) {
				return "Backend route plugins must declare api.routes or backend.routes.";
			}
		}
		const indexer = manifest.targets["flixer-indexer"];
		if (indexer && !indexer.entry.toLowerCase().endsWith(".wasm"))
			return "Indexer plugins must use a WASI .wasm entry point.";
		if (indexer && !manifest.capabilities.some((capability) => capability.startsWith("indexer.provider.")))
			return "Indexer plugins must declare at least one indexer.provider capability.";
		if (!backend && !indexer) return "Plugin has no supported service target.";
		return null;
	}

	private async requireDependencies(manifest: ReturnType<typeof parsePluginManifest>): Promise<void> {
		const installed = await this.dataSource.getRepository(PluginInstallation).find();
		const byId = new Map(installed.map((item) => [item.pluginId, item]));
		const visiting = new Set<string>();
		const visited = new Set<string>();
		const missing = new Set<string>();

		const visit = (id: string, dependencies: Record<string, string>) => {
			if (visiting.has(id)) throw new BadRequest(`Plugin dependency cycle includes ${id}.`);
			if (visited.has(id)) return;
			visiting.add(id);
			for (const [dependencyId, range] of Object.entries(dependencies)) {
				if (!semver.validRange(range))
					throw new BadRequest(`Plugin dependency ${dependencyId} has an invalid version range.`);
				if (dependencyId === id || visiting.has(dependencyId)) {
					throw new BadRequest(`Plugin dependency cycle includes ${dependencyId}.`);
				}
				const dependency = byId.get(dependencyId);
				if (!dependency) {
					missing.add(dependencyId);
					continue;
				}
				if (!semver.satisfies(dependency.version, range)) {
					throw new BadRequest(
						`Plugin dependency ${dependencyId} requires ${range}, but ${dependency.version} is installed.`,
					);
				}
				if (!dependency.enabled) missing.add(dependencyId);
				visit(dependencyId, dependency.manifest.dependencies ?? {});
			}
			visiting.delete(id);
			visited.add(id);
		};

		visit(manifest.id, manifest.dependencies ?? {});
		if (missing.size > 0)
			throw new BadRequest(`Install and enable required dependencies first: ${[...missing].join(", ")}.`);
	}

	async addRepository(request: AddPluginRepositoryRequest): Promise<PluginRepository> {
		if (typeof request?.name !== "string" || request.name.trim().length < 1 || request.name.trim().length > 120) {
			throw new BadRequest("Repository name must be between 1 and 120 characters.");
		}

		let url: string;
		try {
			url = normalizePluginRepositoryUrl(request.url);
		} catch (error: unknown) {
			throw new BadRequest(error instanceof Error ? error.message : "Repository URL is invalid.");
		}
		const repositories = this.dataSource.getRepository(PluginRepository);
		if (await repositories.findOneBy({ url })) {
			throw new Conflict("This plugin repository is already registered.");
		}

		let manifest;
		try {
			manifest = await fetchPluginRepositoryManifest(url);
		} catch (error: unknown) {
			throw new BadRequest(
				error instanceof Error ? error.message : "Repository manifest could not be validated.",
			);
		}
		if (manifest.id === "flixer.official") {
			throw new BadRequest("The official repository identifier is reserved.");
		}

		const repository = repositories.create({
			name: request.name.trim(),
			url,
			isOfficial: false,
			enabled: true,
			manifest,
			lastCheckedAt: new Date(),
			lastError: null,
		});
		return repositories.save(repository);
	}

	async refreshRepository(id: string): Promise<PluginRepository> {
		if (!UUID_PATTERN.test(id)) throw new NotFound("Plugin repository not found.");
		const repositories = this.dataSource.getRepository(PluginRepository);
		const repository = await repositories.findOneBy({ id });
		if (!repository) throw new NotFound("Plugin repository not found.");

		let manifest;
		try {
			manifest = await fetchPluginRepositoryManifest(repository.url);
			if (repository.isOfficial && manifest.id !== "flixer.official") {
				throw new Error("The official repository identifier does not match.");
			}
			if (!repository.isOfficial && manifest.id === "flixer.official") {
				throw new Error("The official repository identifier is reserved.");
			}
		} catch (error: unknown) {
			repository.lastCheckedAt = new Date();
			repository.lastError = error instanceof Error ? error.message.slice(0, 1000) : "Repository refresh failed.";
			await repositories.save(repository);
			throw new BadRequest(repository.lastError);
		}
		repository.manifest = manifest;
		repository.lastCheckedAt = new Date();
		repository.lastError = null;
		return repositories.save(repository);
	}

	private async refreshEnabledRepositories(): Promise<void> {
		const repositories = this.dataSource.getRepository(PluginRepository);
		let official = await repositories.findOneBy({ isOfficial: true });
		if (!official) {
			official = await repositories.save(
				repositories.create({
					name: "Official Flixer Plugins",
					url: OFFICIAL_REPOSITORY_URL,
					isOfficial: true,
					enabled: true,
					manifest: null,
					lastCheckedAt: null,
					lastError: null,
				}),
			);
		}
		const enabled = await repositories.find({ where: { enabled: true } });
		for (const repository of enabled) {
			try {
				await this.refreshRepository(repository.id);
			} catch (error: unknown) {
				logger().warn(`Could not refresh plugin repository ${repository.name}.`, error);
			}
		}
	}

	private async refreshPluginHealth(): Promise<void> {
		let statuses: IndexerPluginStatus[];
		try {
			statuses = await this.indexer.pluginStatuses();
		} catch {
			return;
		}
		const statusById = new Map(statuses.map((status) => [status.id, status]));
		const repository = this.dataSource.getRepository(PluginInstallation);
		const enabled = await repository.find({ where: { enabled: true } });
		for (const installation of enabled) {
			if (!installation.manifest.targets["flixer-indexer"]) continue;
			const target = statusById.get(installation.pluginId);
			if (!target) {
				installation.status = "error";
				installation.lastError = "Indexer did not report this enabled plugin.";
				installation.targetStatus = { ...installation.targetStatus, "flixer-indexer": "missing" };
			} else if (target.state === "registered") {
				installation.status = "running";
				installation.lastError = null;
				installation.targetStatus = { ...installation.targetStatus, "flixer-indexer": "running" };
			} else {
				installation.status = "error";
				installation.lastError = (target.error || "Indexer could not load this plugin.").slice(0, 1000);
				installation.targetStatus = { ...installation.targetStatus, "flixer-indexer": "error" };
			}
			await repository.save(installation);
		}
	}

	async removeRepository(id: string): Promise<void> {
		if (!UUID_PATTERN.test(id)) {
			throw new NotFound("Plugin repository not found.");
		}
		const repositories = this.dataSource.getRepository(PluginRepository);
		const repository = await repositories.findOneBy({ id });
		if (!repository) {
			throw new NotFound("Plugin repository not found.");
		}
		if (repository.isOfficial) {
			throw new BadRequest("The official Flixer plugin repository cannot be removed.");
		}

		await repositories.remove(repository);
	}
}
