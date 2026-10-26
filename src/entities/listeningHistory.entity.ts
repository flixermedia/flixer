import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/** The songs a user has played, most recent play per song. Video history lives in watch_progress. */
@Entity("listening_history")
@Index("idx_listening_history_user_played", ["userId", "playedAt"])
export class ListeningHistory {

	@PrimaryColumn({ name: "user_id", type: "uuid" })
	userId!: string;

	@PrimaryColumn({ name: "item_id", type: "uuid" })
	itemId!: string;

	@Column({ name: "played_at", type: "timestamptz", default: () => "now()" })
	playedAt!: Date;

	@Column({ name: "play_count", type: "integer", default: 1 })
	playCount!: number;
}
