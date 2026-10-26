import { isDeepStrictEqual } from "node:util";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { parsePluginManifest, type PluginManifest } from "./pluginManifest.js";
import { extractPluginArchive } from "./safePluginArchive.js";

export interface PluginPackageInstallResult {
	pluginId: string;
	version: string;
	packageDigest: string;
	installPath: string;
	manifest: PluginManifest;
}

export async function installPluginPackageAtomically(
	pluginsPath: string,
	archive: Buffer,
	expectedManifest: PluginManifest,
	packageDigest: string,
	persist: (result: PluginPackageInstallResult) => Promise<void>,
): Promise<PluginPackageInstallResult> {
	if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(expectedManifest.id)) {
		throw new Error("Plugin id is invalid for installation.");
	}

	const installedRoot = join(pluginsPath, "installed");
	const tempRoot = join(pluginsPath, "temp");
	const dataRoot = join(pluginsPath, "data", expectedManifest.id);
	await Promise.all([
		mkdir(installedRoot, { recursive: true, mode: 0o755 }),
		mkdir(tempRoot, { recursive: true, mode: 0o700 }),
		mkdir(join(pluginsPath, "cache"), { recursive: true, mode: 0o700 }),
		mkdir(dataRoot, { recursive: true, mode: 0o700 }),
	]);

	const temporary = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tempRoot, "install-")));
	const staged = join(temporary, "package");
	const target = join(installedRoot, expectedManifest.id);
	const previous = join(temporary, "previous");
	let previousMoved = false;
	let newMoved = false;

	try {
		await mkdir(staged, { mode: 0o755 });
		await extractPluginArchive(archive, staged);

		let packagedManifest: PluginManifest;
		try {
			packagedManifest = parsePluginManifest(JSON.parse(await readFile(join(staged, "plugin.json"), "utf8")) as unknown);
		} catch (error: unknown) {
			throw new Error(`Plugin package manifest is missing or invalid: ${error instanceof Error ? error.message : "unknown error"}`);
		}
		if (
			packagedManifest.id !== expectedManifest.id ||
			packagedManifest.version !== expectedManifest.version ||
			!isDeepStrictEqual(packagedManifest, expectedManifest)
		) {
			throw new Error("Plugin package manifest does not match the repository release manifest.");
		}

		for (const targetEntry of Object.values(packagedManifest.targets)) {
			const requiredPath = resolve(staged, targetEntry.entry);
			if (!requiredPath.startsWith(`${resolve(staged)}${sep}`)) {
				throw new Error("Plugin entry point escapes its package directory.");
			}
			await stat(requiredPath);
		}
		if (packagedManifest.settingsSchema) {
			await stat(resolve(staged, packagedManifest.settingsSchema));
		}

		try {
			await stat(target);
			await rename(target, previous);
			previousMoved = true;
		} catch (error: unknown) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}

		await rename(staged, target);
		newMoved = true;
		const result = {
			pluginId: packagedManifest.id,
			version: packagedManifest.version,
			packageDigest,
			installPath: target,
			manifest: packagedManifest,
		};
		await persist(result);
		if (previousMoved) await rm(previous, { recursive: true, force: true });
		return result;
	} catch (error: unknown) {
		if (newMoved) await rm(target, { recursive: true, force: true });
		if (previousMoved) await rename(previous, target);
		throw error;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}