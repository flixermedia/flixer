import { Check, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from "typeorm";
import { MediaItem } from "./mediaItem.entity.js";

// Constraint names are the ones created by the hand-written migration
// (unnamed foreign keys carry the names PostgreSQL generated for them).

/** Groups a source media item under a primary one without changing either row; a source belongs to one group. */
@Entity("media_source_groups")
@Unique("uq_media_source_groups_source", ["sourceId"])
@Check("ck_media_source_groups_distinct", `"primary_id" <> "source_id"`)
export class MediaSourceGroup {

	@PrimaryColumn({ name: "primary_id", type: "uuid", primaryKeyConstraintName: "pk_media_source_groups" })
	primaryId!: string;

	@PrimaryColumn({ name: "source_id", type: "uuid", primaryKeyConstraintName: "pk_media_source_groups" })
	sourceId!: string;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "primary_id", foreignKeyConstraintName: "media_source_groups_primary_id_fkey" })
	primary?: MediaItem;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "source_id", foreignKeyConstraintName: "media_source_groups_source_id_fkey" })
	source?: MediaItem;
}
