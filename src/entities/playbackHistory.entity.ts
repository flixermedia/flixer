import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("playback_history")
@Index("idx_playback_history_user_started", ["userId", "startedAt"])
@Index("idx_playback_history_user_item", ["userId", "itemId"])
export class PlaybackHistory {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ name: "kind", type: "varchar", length: 8 })
	kind!: "video" | "music" | "live";

	@Column({ name: "item_id", type: "uuid", nullable: true })
	itemId!: string | null;

	@Column({ name: "channel_id", type: "text", nullable: true })
	channelId!: string | null;

	@Column({ name: "channel_name", type: "text", nullable: true })
	channelName!: string | null;

	@Column({ name: "watched_seconds", type: "real", default: 0 })
	watchedSeconds!: number;

	@CreateDateColumn({ name: "started_at", type: "timestamptz" })
	startedAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
