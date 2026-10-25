import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export const SEGMENT_TYPES = ["intro", "recap", "credits", "preview", "commercial"] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

/** Where a stored segment came from. Chapter-derived segments are computed on read and never stored. */
export const SEGMENT_SOURCES = ["manual", "skipme"] as const;
export type SegmentSource = (typeof SEGMENT_SOURCES)[number];

/** A skippable span of one item (an intro, credits, …) with its position in milliseconds. */
@Entity("media_segments")
export class MediaSegment {

	@PrimaryColumn({ name: "item_id", type: "uuid" })
	itemId!: string;

	@PrimaryColumn({ type: "varchar", length: 16 })
	type!: SegmentType;

	@PrimaryColumn({ type: "varchar", length: 16 })
	source!: SegmentSource;

	@Column({ name: "start_ms", type: "integer" })
	startMs!: number;

	@Column({ name: "end_ms", type: "integer" })
	endMs!: number;

	/** How many user submissions a crowd-sourced entry averages; 0 for manual ones. */
	@Column({ type: "integer", default: 0 })
	submissions!: number;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
