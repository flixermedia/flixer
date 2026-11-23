import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";
import { Advertisement } from "./advertisement.entity.js";
import { MediaItem } from "./mediaItem.entity.js";
import { User } from "./user.entity.js";

// Constraint and index names are the ones created by the hand-written migrations
// (unnamed constraints carry the names PostgreSQL generated for them).

/** One user's interaction with one advertisement; reports for the same view id merge. */
@Entity("advertisement_views")
@Index("idx_advertisement_views_ad", ["advertisementId"])
@Index("idx_advertisement_views_created", ["createdAt"])
export class AdvertisementView {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "advertisement_views_pkey" })
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "advertisement_views_user_id_fkey" })
	user?: User;

	@Column({ name: "advertisement_id", type: "uuid" })
	advertisementId!: string;

	@ManyToOne(() => Advertisement, { onDelete: "CASCADE" })
	@JoinColumn({ name: "advertisement_id", foreignKeyConstraintName: "advertisement_views_advertisement_id_fkey" })
	advertisement?: Advertisement;

	@Column({ name: "watched_seconds", type: "double precision", default: 0 })
	watchedSeconds!: number;

	@Column({ type: "boolean", default: false })
	completed!: boolean;

	@Column({ type: "boolean", default: false })
	skipped!: boolean;

	@Column({ type: "boolean", default: false })
	clicked!: boolean;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
	updatedAt!: Date;
}

/** A video or live-channel viewing session: either `itemId` or both channel columns are set. */
@Entity("viewing_sessions")
@Check("viewing_sessions_check", `("item_id" IS NOT NULL AND "channel_id" IS NULL AND "channel_name" IS NULL) OR ("item_id" IS NULL AND "channel_id" IS NOT NULL AND "channel_name" IS NOT NULL)`)
@Index("idx_viewing_sessions_created", ["createdAt"])
@Index("idx_viewing_sessions_user", ["userId"])
@Index("idx_viewing_sessions_item", ["itemId"])
export class ViewingSession {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "viewing_sessions_pkey" })
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "viewing_sessions_user_id_fkey" })
	user?: User;

	@Column({ name: "item_id", type: "uuid", nullable: true })
	itemId!: string | null;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "item_id", foreignKeyConstraintName: "viewing_sessions_item_id_fkey" })
	item?: MediaItem | null;

	@Column({ name: "channel_id", type: "text", nullable: true })
	channelId!: string | null;

	@Column({ name: "channel_name", type: "text", nullable: true })
	channelName!: string | null;

	@Column({ name: "watched_seconds", type: "double precision", default: 0 })
	watchedSeconds!: number;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
	updatedAt!: Date;
}

/** One music play; `id` is a database-generated bigint identity (a string in JS). */
@Entity("listening_events")
@Index("idx_listening_events_created", ["createdAt"])
@Index("idx_listening_events_user", ["userId"])
@Index("idx_listening_events_item", ["itemId"])
export class ListeningEvent {

	@PrimaryGeneratedColumn("identity", { type: "bigint", generatedIdentity: "ALWAYS", primaryKeyConstraintName: "listening_events_pkey" })
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "listening_events_user_id_fkey" })
	user?: User;

	@Column({ name: "item_id", type: "uuid" })
	itemId!: string;

	@ManyToOne(() => MediaItem, { onDelete: "CASCADE" })
	@JoinColumn({ name: "item_id", foreignKeyConstraintName: "listening_events_item_id_fkey" })
	item?: MediaItem;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;
}

/** A session id a user removed from their playback history, so later reports of it are not re-added. */
@Entity("playback_history_hidden_sessions")
export class PlaybackHistoryHiddenSession {

	@PrimaryColumn({ name: "user_id", type: "uuid", primaryKeyConstraintName: "playback_history_hidden_sessions_pkey" })
	userId!: string;

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "playback_history_hidden_sessions_pkey" })
	id!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "playback_history_hidden_sessions_user_id_fkey" })
	user?: User;
}
