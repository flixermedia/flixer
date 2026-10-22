import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** How far one user has watched one item. `completed` rows are kept so a finished title stays out of "Continue watching". */
@Entity("watch_progress")
@Index("idx_watch_progress_user_updated", ["userId", "updatedAt"])
export class WatchProgress {

	@PrimaryColumn({ name: "user_id", type: "uuid" })
	userId!: string;

	@PrimaryColumn({ name: "item_id", type: "uuid" })
	itemId!: string;

	@Column({ name: "position_seconds", type: "integer", default: 0 })
	positionSeconds!: number;

	@Column({ name: "duration_seconds", type: "integer", default: 0 })
	durationSeconds!: number;

	@Column({ type: "boolean", default: false })
	completed!: boolean;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
