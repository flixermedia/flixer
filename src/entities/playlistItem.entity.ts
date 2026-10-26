import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/** A song in a playlist; `position` is its place in the order. */
@Entity("playlist_items")
@Index("idx_playlist_items_order", ["playlistId", "position"])
export class PlaylistItem {

	@PrimaryColumn({ name: "playlist_id", type: "uuid" })
	playlistId!: string;

	@PrimaryColumn({ name: "item_id", type: "uuid" })
	itemId!: string;

	@Column({ type: "integer", default: 0 })
	position!: number;

	@Column({ name: "added_at", type: "timestamptz", default: () => "now()" })
	addedAt!: Date;
}
