import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from "typeorm";
import { MediaItem } from "./mediaItem.entity.js";
import { User } from "./user.entity.js";

// Constraint names are the PostgreSQL defaults of the unnamed constraints in createUserMediaFeatures1798300000028.

/** A user's named, ordered set of videos. */
@Entity("video_collections")
@Index("idx_video_collections_user_updated", ["userId", "updatedAt"])
export class VideoCollection {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "video_collections_pkey" })
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "video_collections_user_id_fkey" })
	user?: User;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	@Column({ type: "varchar", length: 500, nullable: true })
	description!: string | null;

	@Column({ name: "is_public", type: "boolean", default: false })
	isPublic!: boolean;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
	updatedAt!: Date;
}

@Entity("video_collection_items")
@Check("video_collection_items_position_check", `"position" >= 0`)
@Unique("video_collection_items_collection_id_position_key", ["collectionId", "position"])
export class VideoCollectionItem {

	@PrimaryColumn({ name: "collection_id", type: "uuid", primaryKeyConstraintName: "video_collection_items_pkey" })
	collectionId!: string;

	@PrimaryColumn({ name: "item_id", type: "uuid", primaryKeyConstraintName: "video_collection_items_pkey" })
	itemId!: string;

	@ManyToOne(() => VideoCollection, { onDelete: "CASCADE" })
	@JoinColumn({ name: "collection_id", foreignKeyConstraintName: "video_collection_items_collection_id_fkey" })
	collection?: VideoCollection;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "item_id", foreignKeyConstraintName: "video_collection_items_item_id_fkey" })
	item?: MediaItem;

	@Column({ type: "integer" })
	position!: number;

	@Column({ name: "added_at", type: "timestamptz", default: () => "now()" })
	addedAt!: Date;
}
