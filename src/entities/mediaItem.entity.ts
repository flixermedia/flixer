import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export const MEDIA_ITEM_TYPES = ["movie", "series", "season", "episode", "album", "track", "video"] as const;
export type MediaItemType = (typeof MEDIA_ITEM_TYPES)[number];

/**
 * An item found by flixer-indexer. Shows, seasons and episodes (and albums and tracks) form a tree through
 * parentId. Identity is externalKey (a provider id such as `tmdb:1399:s1:e2`, or `path:<path>` while unidentified)
 * so renaming files or folders updates the same row instead of creating a new one.
 */
@Entity("media_items")
@Index("UQ_media_items_library_key", ["libraryId", "externalKey"], { unique: true })
@Index("IDX_media_items_library_path", ["libraryId", "path"])
@Index("IDX_media_items_parent", ["parentId"])
export class MediaItem {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "library_id", type: "uuid" })
	libraryId!: string;

	@Column({ name: "parent_id", type: "uuid", nullable: true })
	parentId!: string | null;

	@Column({ type: "varchar", length: 16 })
	type!: MediaItemType;

	@Column({ name: "external_key", type: "text" })
	externalKey!: string;

	@Column({ type: "text" })
	path!: string;

	@Column({ name: "root_id", type: "varchar", length: 64, nullable: true })
	rootId!: string | null;

	@Column({ name: "relative_path", type: "text", nullable: true })
	relativePath!: string | null;

	@Column({ type: "text" })
	title!: string;

	@Column({ name: "sort_title", type: "text", nullable: true })
	sortTitle!: string | null;

	@Column({ type: "int", nullable: true })
	year!: number | null;

	@Column({ name: "season_number", type: "int", nullable: true })
	seasonNumber!: number | null;

	@Column({ name: "episode_number", type: "int", nullable: true })
	episodeNumber!: number | null;

	@Column({ name: "episode_end_number", type: "int", nullable: true })
	episodeEndNumber!: number | null;

	@Column({ name: "provider_ids", type: "jsonb", default: () => "'{}'" })
	providerIds!: Record<string, string>;

	@Column({ type: "jsonb", default: () => "'{}'" })
	metadata!: Record<string, unknown>;

	@Column({ type: "jsonb", default: () => "'[]'" })
	images!: unknown[];

	@Column({ type: "jsonb", nullable: true })
	technical!: Record<string, unknown> | null;

	@Column({
		name: "size_bytes",
		type: "bigint",
		nullable: true,
		transformer: { to: (value: number | null) => value, from: (value: string | null) => (value === null ? null : Number(value)) },
	})
	sizeBytes!: number | null;

	@Column({ name: "modified_at", type: "timestamptz", nullable: true })
	modifiedAt!: Date | null;

	@Column({ name: "nfo_present", type: "boolean", default: false })
	nfoPresent!: boolean;

	@Column({ name: "local_images_used", type: "boolean", default: false })
	localImagesUsed!: boolean;

	/** Created for a child that arrived before its parent; replaced with real data when the parent is indexed. */
	@Column({ name: "is_placeholder", type: "boolean", default: false })
	isPlaceholder!: boolean;

	/** Fields an admin corrected by hand. Re-scans keep these instead of overwriting them. */
	@Column({ name: "edited_fields", type: "jsonb", default: () => "'[]'" })
	editedFields!: string[];

	/** Set on every indexer upsert; a finished scan removes items it did not touch. */
	@Column({ name: "last_seen_at", type: "timestamptz", nullable: true })
	lastSeenAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
