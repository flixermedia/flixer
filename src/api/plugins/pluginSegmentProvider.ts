import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { SEGMENT_TYPES, type SegmentType } from "../../entities/mediaSegment.entity.js";
import { PluginWasiRuntime } from "./pluginWasiRuntime.js";

export const SEGMENT_PROVIDER_CAPABILITY = "media.segments";
export const SEGMENT_PROVIDER_PERMISSION = "media.segments.lookup";

export interface SegmentLookupItem {
	type: "movie" | "episode";
	durationMs: number;
	providerIds: Record<string, string>;
	season?: number;
	episode?: number;
}

export interface ProvidedSegment {
	startMs: number;
	endMs: number;
	submissions: number;
}

/** Per-type result: a segment to store, or null when the provider has none and any stored one should go. */
export type ProvidedSegments = Partial<Record<SegmentType, ProvidedSegment | null>>;

function validSegment(value: unknown): value is ProvidedSegment {
	const segment = value as Partial<ProvidedSegment> | null;
	return (
		typeof segment === "object" &&
		segment !== null &&
		Number.isInteger(segment.startMs) &&
		Number.isInteger(segment.endMs) &&
		Number.isInteger(segment.submissions) &&
		(segment.startMs as number) >= 0 &&
		(segment.endMs as number) > (segment.startMs as number) &&
		(segment.submissions as number) >= 0
	);
}

export type SegmentLookupOutcome =
	{ status: "no-provider" } | { status: "failed" } | { status: "ok"; segments: ProvidedSegments };

/** Lets an enabled, approved plugin supply crowd-sourced media segments (e.g. SkipMe.db). */
@Injectable()
export class PluginSegmentProvider {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly runtime: PluginWasiRuntime,
	) {}

	/** "no-provider" lets callers use the built-in path; "failed" means a provider owns lookups but could not answer. */
	async lookup(item: SegmentLookupItem, settings: { baseUrl: string }): Promise<SegmentLookupOutcome> {
		const installations = await this.dataSource.getRepository(PluginInstallation).findBy({ enabled: true });
		const provider = installations.find(
			(installation) =>
				installation.manifest.targets.flixer &&
				installation.manifest.capabilities.includes(SEGMENT_PROVIDER_CAPABILITY) &&
				installation.manifest.permissions.includes(SEGMENT_PROVIDER_PERMISSION) &&
				installation.approvedPermissions.includes(SEGMENT_PROVIDER_PERMISSION),
		);
		if (!provider) return { status: "no-provider" };

		const pluginUrl = provider.settings.apiUrl;
		const baseUrl = typeof pluginUrl === "string" && pluginUrl.trim() ? pluginUrl.trim() : settings.baseUrl;
		// An empty URL turns lookups off, as it does for the built-in path.
		if (!baseUrl) return { status: "ok", segments: {} };

		try {
			const result = (await this.runtime.execute(
				provider,
				"lookup",
				{ id: "system", role: "system" },
				{
					item,
					baseUrl,
				},
			)) as { segments?: Record<string, unknown> } | null;
			const segments: ProvidedSegments = {};
			for (const type of SEGMENT_TYPES) {
				const value = result?.segments?.[type];
				if (value === null) segments[type] = null;
				else if (validSegment(value))
					segments[type] = { startMs: value.startMs, endMs: value.endMs, submissions: value.submissions };
			}
			return { status: "ok", segments };
		} catch (error: unknown) {
			logger().warn(`Segment provider ${provider.pluginId} failed.`, error);
			return { status: "failed" };
		}
	}
}
