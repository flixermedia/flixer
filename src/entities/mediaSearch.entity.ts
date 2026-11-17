import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";
import { MediaItem } from "./mediaItem.entity.js";

// Constraint and index names are the ones created by the hand-written migrations
// (unnamed constraints carry the names PostgreSQL generated for them).

/** A pending change for the search index; media_items triggers enqueue rows, the search worker drains them. */
@Entity("media_search_outbox")
@Check("CHK_media_search_outbox_operation", `"operation" IN ('upsert', 'delete', 'rebuild', 'reset')`)
@Index("IDX_media_search_outbox_ready", ["nextAttemptAt", "lockedUntil", "eventId"])
@Index("UQ_media_search_outbox_rebuild", ["operation"], { unique: true, where: `"operation" = 'rebuild'` })
@Index("UQ_media_search_outbox_reset", ["operation"], { unique: true, where: `"operation" = 'reset'` })
export class MediaSearchOutboxEvent {

	/** A bigserial, so a string in JS. */
	@PrimaryGeneratedColumn("increment", { name: "event_id", type: "bigint", primaryKeyConstraintName: "media_search_outbox_pkey" })
	eventId!: string;

	@Column({ name: "item_id", type: "uuid", nullable: true })
	itemId!: string | null;

	@Column({ type: "text" })
	operation!: "upsert" | "delete" | "rebuild" | "reset";

	@Column({ type: "jsonb", nullable: true })
	document!: Record<string, unknown> | null;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ type: "integer", default: 0 })
	attempts!: number;

	@Column({ name: "next_attempt_at", type: "timestamptz", default: () => "now()" })
	nextAttemptAt!: Date;

	@Column({ name: "locked_until", type: "timestamptz", nullable: true })
	lockedUntil!: Date | null;

	@Column({ name: "last_error", type: "text", nullable: true })
	lastError!: string | null;
}

/** Lyrics text indexed alongside a track's search document. */
@Entity("media_search_lyrics")
export class MediaSearchLyrics {

	@PrimaryColumn({ name: "item_id", type: "uuid", primaryKeyConstraintName: "media_search_lyrics_pkey" })
	itemId!: string;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "item_id", foreignKeyConstraintName: "media_search_lyrics_item_id_fkey" })
	item?: MediaItem;

	@Column({ type: "text" })
	lyrics!: string;

	@Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
	updatedAt!: Date;
}
