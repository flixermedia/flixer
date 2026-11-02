import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type GuideSourceKind = "epg" | "iptv";

export interface GuideChannelCache {
	externalId: string;
	name: string;
	icon: string | null;
}

export interface GuideProgrammeCache {
	channelExternalId: string;
	start: number;
	stop: number;
	title: string;
	subtitle: string | null;
	description: string | null;
	category: string | null;
}

export interface IptvChannelCache {
	externalId: string;
	tvgId: string | null;
	name: string;
	icon: string | null;
	group: string | null;
	url: string;
}

export interface EpgSourceCache {
	channels: GuideChannelCache[];
	programmes: GuideProgrammeCache[];
}

export interface IptvSourceCache {
	channels: IptvChannelCache[];
}

export interface GuideChannelSettings {
	enabled?: boolean;
	sortOrder?: number;
	iptvChannelId?: string | null;
}

export type GuideSourceCache = EpgSourceCache | IptvSourceCache;

@Entity("guide_sources")
@Index("UQ_guide_sources_kind_url", ["kind", "url"], { unique: true })
export class GuideSource {
	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 8 })
	kind!: GuideSourceKind;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	@Column({ type: "text" })
	url!: string;

	@Column({ type: "boolean", default: true })
	enabled!: boolean;

	@Column({ name: "is_default", type: "boolean", default: false })
	isDefault!: boolean;

	@Column({ name: "sort_order", type: "integer", default: 0 })
	sortOrder!: number;

	@Column({ type: "jsonb", default: () => '\'{"channels":[],"programmes":[]}\'' })
	cache!: GuideSourceCache;

	@Column({ name: "channel_settings", type: "jsonb", default: () => "'{}'" })
	channelSettings!: Record<string, GuideChannelSettings>;

	@Column({ name: "last_refreshed_at", type: "timestamptz", nullable: true })
	lastRefreshedAt!: Date | null;

	@Column({ name: "last_error", type: "text", nullable: true })
	lastError!: string | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}

@Entity("guide_settings")
export class GuideSettings {
	@PrimaryColumn({ type: "smallint", default: 1 })
	id!: number;

	@Column({ name: "regional_merge_threshold_percent", type: "integer", default: 65 })
	regionalMergeThresholdPercent!: number;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
