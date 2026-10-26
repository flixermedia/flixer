import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "./plugin-manifest.schema.json" with { type: "json" };

export type PluginTargetName = "flixer" | "flixer-indexer" | "flixer-streamer" | "flixer-web";

export interface PluginManifest {
	manifestVersion: 1;
	id: string;
	name: string;
	version: string;
	description: string;
	author: string;
	license: string;
	homepage?: string;
	icon?: string;
	compatibility: {
		pluginApi: string;
		flixer?: string;
		"flixer-indexer"?: string;
		"flixer-streamer"?: string;
		"flixer-web"?: string;
	};
	targets: Partial<Record<PluginTargetName, { entry: string }>>;
	capabilities: string[];
	permissions: string[];
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	settingsSchema?: string;
	ui?: { adminPages?: PluginAdminPage[] };
}

/** A settings page a plugin contributes to an admin section; rendered from its settings schema, never plugin code. */
export interface PluginAdminPage {
	id: string;
	title: string;
	description?: string;
	section: "providers";
}

const validate = new Ajv2020({ allErrors: true, strict: true }).compile<PluginManifest>(schema);

export function parsePluginManifest(value: unknown): PluginManifest {
	if (!validate(value)) {
		const details = (validate.errors ?? [])
			.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
			.join("; ");
		throw new Error(`Invalid plugin manifest: ${details}`);
	}

	return value as PluginManifest;
}
