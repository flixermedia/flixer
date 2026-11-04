import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

export type MailDirection = "inbound" | "outbound";
export type MailStatus = "received" | "queued" | "sent" | "failed";

export interface MailAttachmentInfo {
	id: string;
	filename: string;
	contentType: string;
	size: number;
}

@Entity("mail_messages")
@Index("idx_mail_messages_mailbox_created", ["mailboxId", "createdAt"])
@Index("idx_mail_messages_status_next", ["status", "nextAttemptAt"])
export class MailMessage {

	@PrimaryColumn("uuid")
	id!: string;

	/** The mailbox this message belongs to: the recipient for inbound mail, the sender for outbound mail. */
	@Column({ name: "mailbox_id", type: "uuid", nullable: true })
	mailboxId!: string | null;

	@Column({ type: "varchar", length: 8 })
	direction!: MailDirection;

	@Column({ type: "varchar", length: 8 })
	status!: MailStatus;

	@Column({ name: "from_address", type: "varchar", length: 320 })
	fromAddress!: string;

	@Column({ name: "from_name", type: "varchar", length: 200, nullable: true })
	fromName!: string | null;

	@Column({ name: "to_addresses", type: "jsonb", default: () => "'[]'" })
	toAddresses!: string[];

	@Column({ type: "varchar", length: 998, default: "" })
	subject!: string;

	@Column({ type: "text", default: "" })
	text!: string;

	/** Raw HTML as received or sent; sanitised before it is returned by the API. */
	@Column({ type: "text", nullable: true })
	html!: string | null;

	@Column({ name: "message_id", type: "varchar", length: 998, nullable: true })
	messageId!: string | null;

	@Column({ name: "in_reply_to", type: "varchar", length: 998, nullable: true })
	inReplyTo!: string | null;

	/** Automatic system mail (noreply), sent with Auto-Submitted headers. */
	@Column({ name: "is_system", type: "boolean", default: false })
	isSystem!: boolean;

	@Column({ type: "jsonb", default: () => "'[]'" })
	attachments!: MailAttachmentInfo[];

	/** SPF/DKIM/DMARC summary for inbound mail, e.g. { spf: "pass", dkim: "pass", dmarc: "pass" }. */
	@Column({ name: "auth_results", type: "jsonb", nullable: true })
	authResults!: Record<string, string> | null;

	@Column({ name: "remote_address", type: "varchar", length: 64, nullable: true })
	remoteAddress!: string | null;

	@Column({ type: "integer", default: 0 })
	attempts!: number;

	@Column({ name: "next_attempt_at", type: "timestamptz", nullable: true })
	nextAttemptAt!: Date | null;

	@Column({ name: "last_error", type: "text", nullable: true })
	lastError!: string | null;

	@Column({ name: "sent_at", type: "timestamptz", nullable: true })
	sentAt!: Date | null;

	@Column({ name: "read_at", type: "timestamptz", nullable: true })
	readAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
