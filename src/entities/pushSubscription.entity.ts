import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** A browser or device that agreed to receive Web Push notifications for one user. */
@Entity("push_subscriptions")
export class PushSubscription {

	@PrimaryColumn("uuid")
	id!: string;

	@Index("idx_push_subscriptions_user")
	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Index("UQ_push_subscriptions_endpoint", { unique: true })
	@Column({ type: "varchar", length: 1024 })
	endpoint!: string;

	@Column({ type: "varchar", length: 256 })
	p256dh!: string;

	@Column({ type: "varchar", length: 128 })
	auth!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
