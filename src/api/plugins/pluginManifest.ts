import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "./plugin-manifest.schema.json" with { type: "json" };
import type { PluginInstallation } from "../../entities/pluginInstallation.entity.js";

export type PluginTargetName = "flixer" | "flixer-indexer" | "flixer-streamer" | "flixer-web";

export function updatePluginTargetHealth(
	installation: Pick<PluginInstallation, "targetStatus" | "status" | "lastError">,
	target: PluginTargetName,
	state: "running" | "error" | "missing",
	error?: string,
): void {
	installation.targetStatus = { ...installation.targetStatus, [target]: state };
	const failed = Object.values(installation.targetStatus).some((value) => value === "error" || value === "missing");
	installation.status = failed ? "error" : "running";
	installation.lastError = failed ? (state === "running" ? "One or more plugin targets are unavailable." : error ?? "Plugin target is unavailable.") : null;
}

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
	database?: { tables: Record<string, PluginTableDefinition> };
	schedules?: Array<{ operation: string; intervalSeconds: number }>;
	ui?: { pages?: PluginUiPage[]; slots?: PluginUiSlot[] };
}

export type PluginColumnType = "text" | "integer" | "boolean" | "timestamp" | "json" | "uuid";

export interface PluginColumnDefinition {
	type: PluginColumnType;
	primary?: boolean;
	nullable?: boolean;
	/** For timestamps the string "now" means the insertion time. */
	default?: string | number | boolean | null;
}

export interface PluginTableDefinition {
	columns: Record<string, PluginColumnDefinition>;
	indexes?: Array<{ columns: string[]; unique?: boolean }>;
}

/** A page the plugin renders through the server-driven UI protocol. */
export interface PluginUiPage {
	id: string;
	title: string;
	nav?: "main";
	adminOnly?: boolean;
}

export interface PluginUiSlot {
	id: string;
	title: string;
	location: "media.detail" | "player.controls";
	adminOnly?: boolean;
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
