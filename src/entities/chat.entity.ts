import { Column, Entity, Generated, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ChatConversation } from "./chatConversation.entity.js";
import { User } from "./user.entity.js";

// Constraint and index names are the ones created by the hand-written migrations.

/** A person's membership of a conversation, with their read marker. */
@Entity("chat_members")
@Index("idx_chat_members_user", ["userId"])
export class ChatMember {

	@PrimaryColumn({ name: "conversation_id", type: "uuid", primaryKeyConstraintName: "pk_chat_members" })
	conversationId!: string;

	@PrimaryColumn({ name: "user_id", type: "uuid", primaryKeyConstraintName: "pk_chat_members" })
	userId!: string;

	@ManyToOne(() => ChatConversation, { onDelete: "CASCADE" })
	@JoinColumn({ name: "conversation_id", foreignKeyConstraintName: "fk_chat_members_conversation" })
	conversation?: ChatConversation;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "fk_chat_members_user" })
	user?: User;

	@Column({ type: "varchar", length: 8, default: "member" })
	role!: string;

	@Column({ name: "joined_at", type: "timestamptz", default: () => "now()" })
	joinedAt!: Date;

	@Column({ name: "last_read_at", type: "timestamptz", default: () => "now()" })
	lastReadAt!: Date;
}

/** A message in a conversation; `sequence` is a global bigserial (a string in JS) that orders pagination. */
@Entity("chat_messages")
@Index("idx_chat_messages_conversation_created", ["conversationId", "createdAt"])
@Index("idx_chat_messages_conversation_sequence", ["conversationId", "sequence"])
export class ChatMessage {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "pk_chat_messages" })
	id!: string;

	@Column({ name: "conversation_id", type: "uuid" })
	conversationId!: string;

	@ManyToOne(() => ChatConversation, { onDelete: "CASCADE" })
	@JoinColumn({ name: "conversation_id", foreignKeyConstraintName: "fk_chat_messages_conversation" })
	conversation?: ChatConversation;

	@Column({ name: "user_id", type: "uuid", nullable: true })
	userId!: string | null;

	@ManyToOne(() => User, { onDelete: "SET NULL" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "fk_chat_messages_user" })
	user?: User | null;

	@Column({ type: "varchar", length: 8, default: "text" })
	kind!: string;

	@Column({ type: "text" })
	body!: string;

	@Column({ type: "boolean", default: false })
	encrypted!: boolean;

	@Column({ type: "bigint" })
	@Generated("increment")
	sequence!: string;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;
}
