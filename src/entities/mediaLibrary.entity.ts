import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

export const MEDIA_LIBRARY_TYPES = ["movies", "tvshows", "music", "homevideos", "mixed"] as const;
export type MediaLibraryType = (typeof MEDIA_LIBRARY_TYPES)[number];

export const MEDIA_IMAGE_STORAGES = ["cache", "alongside"] as const;
export type MediaImageStorage = (typeof MEDIA_IMAGE_STORAGES)[number];

/** A folder inside one of the root media folders declared with STREAM_MEDIA_ROOT. */
export interface MediaLibraryFolder {
	rootId: string;
	/** Forward-slash path relative to the root; empty for the root itself. */
	path: string;
}

@Entity("media_libraries")
export class MediaLibrary {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 100, unique: true })
	name!: string;

	@Column({ type: "varchar", length: 32 })
	type!: MediaLibraryType;

	/** Where the indexer saves downloaded artwork: in the media folders, or in the indexer's own cache. */
	@Column({ name: "image_storage", type: "varchar", length: 16, default: "cache" })
	imageStorage!: MediaImageStorage;

	@Column({ type: "jsonb", default: () => "'[]'" })
	folders!: MediaLibraryFolder[];

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
