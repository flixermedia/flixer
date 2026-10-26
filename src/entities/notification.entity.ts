import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

export type NotificationKind = "new_media" | "admin" | "request" | "message";

/** One message in a user's inbox. */
@Entity("notifications")
@Index("idx_notifications_user_created", ["userId", "createdAt"])
export class Notification {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ type: "varchar", length: 16 })
	kind!: NotificationKind;

	@Column({ type: "varchar", length: 120 })
	title!: string;

	@Column({ type: "varchar", length: 500 })
	body!: string;

	/** In-app path opened when the notification is clicked. */
	@Column({ type: "varchar", length: 300, nullable: true })
	url!: string | null;

	@Column({ name: "read_at", type: "timestamptz", nullable: true })
	readAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
