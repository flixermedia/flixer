import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "./repository-manifest.schema.json" with { type: "json" };
import type { PluginManifest } from "./pluginManifest.js";

export interface PluginRelease {
	version: string;
	manifest: string;
	package: string;
	sha256: string;
	size?: number;
}

export interface PluginRepositoryManifest {
	manifestVersion: 1;
	id: string;
	name: string;
	description: string;
	plugins: Array<{
		id: string;
		name: string;
		description: string;
		author: string;
		capabilities?: string[];
		permissions: string[];
		targets: Array<"flixer" | "flixer-indexer" | "flixer-streamer" | "flixer-web">;
		versions: PluginRelease[];
	}>;
}

export function pluginCatalogMatchesManifest(
	catalogEntry: PluginRepositoryManifest["plugins"][number],
	manifest: PluginManifest,
): boolean {
	const sameSet = (left: string[], right: string[]) =>
		left.length === right.length && left.every((value) => right.includes(value));
	return (
		manifest.id === catalogEntry.id &&
		manifest.name === catalogEntry.name &&
		manifest.description === catalogEntry.description &&
		manifest.author === catalogEntry.author &&
		sameSet(Object.keys(manifest.targets), catalogEntry.targets) &&
		sameSet(manifest.capabilities, catalogEntry.capabilities ?? []) &&
		sameSet(manifest.permissions, catalogEntry.permissions)
	);
}

const validate = new Ajv2020({ allErrors: true, strict: true }).compile<PluginRepositoryManifest>(schema);

export function parsePluginRepositoryManifest(value: unknown): PluginRepositoryManifest {
	if (!validate(value)) {
		const details = (validate.errors ?? [])
			.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
			.join("; ");
		throw new Error(`Invalid plugin repository manifest: ${details}`);
	}

	const ids = new Set<string>();
	for (const plugin of value.plugins) {
		if (ids.has(plugin.id)) {
			throw new Error(`Invalid plugin repository manifest: duplicate plugin id ${plugin.id}.`);
		}
		ids.add(plugin.id);

		const versions = new Set<string>();
		for (const release of plugin.versions) {
			if (versions.has(release.version)) {
				throw new Error(
					`Invalid plugin repository manifest: duplicate version ${release.version} for ${plugin.id}.`,
				);
			}
			versions.add(release.version);
		}
	}

	return value as PluginRepositoryManifest;
}
