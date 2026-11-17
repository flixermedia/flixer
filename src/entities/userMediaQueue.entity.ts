import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from "typeorm";
import { MediaItem } from "./mediaItem.entity.js";
import { User } from "./user.entity.js";

// Constraint names are the PostgreSQL defaults of the unnamed constraints in createUserMediaFeatures1798300000028.

/** One video in a user's ordered "up next" queue. */
@Entity("up_next_queue_items")
@Check("up_next_queue_items_position_check", `"position" >= 0`)
@Unique("up_next_queue_items_user_id_position_key", ["userId", "position"])
export class UpNextQueueItem {

	@PrimaryColumn({ name: "user_id", type: "uuid", primaryKeyConstraintName: "up_next_queue_items_pkey" })
	userId!: string;

	@PrimaryColumn({ name: "item_id", type: "uuid", primaryKeyConstraintName: "up_next_queue_items_pkey" })
	itemId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "up_next_queue_items_user_id_fkey" })
	user?: User;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "item_id", foreignKeyConstraintName: "up_next_queue_items_item_id_fkey" })
	item?: MediaItem;

	@Column({ type: "integer" })
	position!: number;

	@Column({ name: "added_at", type: "timestamptz", default: () => "now()" })
	addedAt!: Date;
}

/** One video a user saved to watch later. */
@Entity("watch_later_items")
@Index("idx_watch_later_user_added", ["userId", "addedAt"])
export class WatchLaterItem {

	@PrimaryColumn({ name: "user_id", type: "uuid", primaryKeyConstraintName: "watch_later_items_pkey" })
	userId!: string;

	@PrimaryColumn({ name: "item_id", type: "uuid", primaryKeyConstraintName: "watch_later_items_pkey" })
	itemId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "watch_later_items_user_id_fkey" })
	user?: User;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "item_id", foreignKeyConstraintName: "watch_later_items_item_id_fkey" })
	item?: MediaItem;

	@Column({ name: "added_at", type: "timestamptz", default: () => "now()" })
	addedAt!: Date;
}

/** A user's explicit feedback about a recommended video. */
@Entity("recommendation_feedback")
@Check("recommendation_feedback_feedback_check", `"feedback" IN ('dismiss', 'more_like_this', 'less_like_this')`)
export class RecommendationFeedback {

	@PrimaryColumn({ name: "user_id", type: "uuid", primaryKeyConstraintName: "recommendation_feedback_pkey" })
	userId!: string;

	@PrimaryColumn({ name: "item_id", type: "uuid", primaryKeyConstraintName: "recommendation_feedback_pkey" })
	itemId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "recommendation_feedback_user_id_fkey" })
	user?: User;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "item_id", foreignKeyConstraintName: "recommendation_feedback_item_id_fkey" })
	item?: MediaItem;

	@Column({ type: "varchar", length: 16 })
	feedback!: string;

	@Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
	updatedAt!: Date;
}
