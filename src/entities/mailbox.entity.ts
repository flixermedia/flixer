import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** `system` addresses (noreply) only send; `inbox` and `user` addresses receive. */
export type MailboxKind = "system" | "inbox" | "user";

@Entity("mailboxes")
export class Mailbox {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 320, unique: true })
	address!: string;

	@Column({ type: "varchar", length: 8 })
	kind!: MailboxKind;

	@Column({ name: "display_name", type: "varchar", length: 100, nullable: true })
	displayName!: string | null;

	/** The user an automatically generated address belongs to; deleting the user removes the mailbox. */
	@Index("uq_mailboxes_user", { unique: true, where: '"user_id" IS NOT NULL' })
	@Column({ name: "user_id", type: "uuid", nullable: true })
	userId!: string | null;

	@Column({ type: "boolean", default: true })
	enabled!: boolean;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
