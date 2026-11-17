import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "./user.entity.js";

/** A direct or group conversation; `encryptionMode` decides whether messages are end-to-end encrypted. */
@Entity("chat_conversations")
@Check("chk_chat_conversation_encryption_mode", `"encryption_mode" IN ('encrypted', 'plaintext')`)
@Index("uq_chat_conversations_direct_key", ["directKey"], { unique: true, where: `"direct_key" IS NOT NULL` })
export class ChatConversation {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "pk_chat_conversations" })
	id!: string;

	@Column({ type: "varchar", length: 8 })
	kind!: string;

	@Column({ type: "varchar", length: 60, nullable: true })
	name!: string | null;

	@Column({ name: "direct_key", type: "varchar", length: 80, nullable: true })
	directKey!: string | null;

	@Column({ name: "created_by", type: "uuid", nullable: true })
	createdBy!: string | null;

	@ManyToOne(() => User, { onDelete: "SET NULL" })
	@JoinColumn({ name: "created_by", foreignKeyConstraintName: "fk_chat_conversations_creator" })
	creator?: User | null;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "last_message_at", type: "timestamptz", default: () => "now()" })
	lastMessageAt!: Date;

	@Column({ name: "encryption_mode", type: "text", default: "plaintext" })
	encryptionMode!: string;
}
