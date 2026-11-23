import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "./user.entity.js";

// Constraint and index names are the ones created by the hand-written migrations
// (unnamed constraints carry the names PostgreSQL generated for them).

/** Singleton (id = 1) policy row: whether user webhooks are on, who may use them and which URLs are allowed. */
@Entity("user_webhook_config")
@Check("user_webhook_config_id_check", `"id" = 1`)
@Check("user_webhook_config_audience_check", `"audience" IN ('admins', 'everyone')`)
export class UserWebhookConfig {

	@PrimaryColumn({ type: "integer", primaryKeyConstraintName: "user_webhook_config_pkey" })
	id!: number;

	@Column({ type: "boolean", default: false })
	enabled!: boolean;

	@Column({ type: "text", default: "admins" })
	audience!: string;

	@Column({ name: "allowed_urls", type: "jsonb", default: () => `'["regex:https?://.*"]'` })
	allowedUrls!: string[];
}

/** A destination URL a user registered for webhook delivery. */
@Entity("user_webhooks")
@Index("idx_user_webhooks_user", ["userId"])
export class UserWebhook {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "user_webhooks_pkey" })
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "user_webhooks_user_id_fkey" })
	user?: User;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	@Column({ type: "text" })
	url!: string;

	@Column({ type: "boolean", default: true })
	enabled!: boolean;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;
}
