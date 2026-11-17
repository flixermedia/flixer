import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { PluginWasiRuntime } from "./pluginWasiRuntime.js";

const HOOKS = {
	authorize: { capability: "streamer.playback.authorize", operation: "streamer-authorize" },
	manifest: { capability: "streamer.manifest", operation: "streamer-manifest" },
	processing: { capability: "streamer.processing", operation: "streamer-processing" },
} as const;
export type StreamerHook = keyof typeof HOOKS;

@Injectable()
export class PluginStreamerService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource, private readonly runtime: PluginWasiRuntime) {}

	private async installations() {
		return this.dataSource.getRepository(PluginInstallation).find({ where: { enabled: true }, order: { pluginId: "ASC" } });
	}

	private matching(installations: PluginInstallation[], hook: StreamerHook) {
		const capability = HOOKS[hook].capability;
		return installations.filter((installation) => installation.manifest.targets["flixer-streamer"] && installation.manifest.capabilities.includes(capability) && installation.manifest.permissions.includes(capability) && installation.approvedPermissions.includes(capability)).slice(0, 16);
	}

	async available(): Promise<StreamerHook[]> {
		const installations = await this.installations();
		const hooks: StreamerHook[] = [];
		for (const hook of Object.keys(HOOKS) as StreamerHook[]) if (this.matching(installations, hook).length > 0) hooks.push(hook);
		return hooks;
	}

	async run(hook: StreamerHook, input: { userId: string; itemId: string; sessionId: string; height?: number; durationSeconds?: number }) {
		const plugins = this.matching(await this.installations(), hook);
		const outcomes = await Promise.allSettled(plugins.map((plugin) => this.runtime.execute(plugin, HOOKS[hook].operation, { id: input.userId, role: "user" }, input, "flixer-streamer")));
		const results = outcomes.flatMap((outcome) => outcome.status === "fulfilled" && outcome.value && typeof outcome.value === "object" && !Array.isArray(outcome.value) ? [outcome.value as Record<string, unknown>] : []);
		if (hook === "authorize") return { allowed: !results.some((result) => result.allowed === false) };
		if (hook === "processing") {
			const heights = results.map((result) => result.maxHeight).filter((value): value is number => typeof value === "number" && [240, 360, 480, 720, 1080].includes(value));
			return { maxHeight: heights.length ? Math.min(...heights) : null };
		}
		const start = results.map((result) => result.startSeconds).find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= (input.durationSeconds ?? 0));
		return { startSeconds: start ?? null };
	}
}