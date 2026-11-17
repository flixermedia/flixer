import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from "typeorm";
import { ChatConversation } from "./chatConversation.entity.js";
import { ChatMessage } from "./chat.entity.js";
import { User } from "./user.entity.js";

// Constraint and index names are the ones created by the hand-written migrations.

/** A user's end-to-end encryption (MLS) device. */
@Entity("chat_mls_devices")
@Unique("uq_chat_mls_devices_user_id", ["userId", "id"])
@Check("ck_chat_mls_devices_status", `"status" IN ('pending', 'active', 'revoked')`)
@Index("idx_chat_mls_devices_user_status", ["userId", "status"])
export class ChatMlsDevice {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "pk_chat_mls_devices" })
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "fk_chat_mls_devices_user" })
	user?: User;

	@Column({ type: "varchar", length: 80 })
	name!: string;

	@Column({ type: "varchar", length: 12, default: "pending" })
	status!: string;

	@Column({ name: "pairing_public_key", type: "text" })
	pairingPublicKey!: string;

	@Column({ name: "approval_challenge", type: "varchar", length: 64, nullable: true })
	approvalChallenge!: string | null;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "approved_at", type: "timestamptz", nullable: true })
	approvedAt!: Date | null;

	@Column({ name: "revoked_at", type: "timestamptz", nullable: true })
	revokedAt!: Date | null;
}

/** A published MLS key package of a device; `usedAt` is set once it is claimed. */
@Entity("chat_mls_key_packages")
@Index("idx_chat_mls_key_packages_available", ["deviceId", "createdAt"], { where: `"used_at" IS NULL` })
export class ChatMlsKeyPackage {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "pk_chat_mls_key_packages" })
	id!: string;

	@Column({ name: "device_id", type: "uuid" })
	deviceId!: string;

	@ManyToOne(() => ChatMlsDevice, { onDelete: "CASCADE" })
	@JoinColumn({ name: "device_id", foreignKeyConstraintName: "fk_chat_mls_key_packages_device" })
	device?: ChatMlsDevice;

	@Column({ name: "key_package", type: "text" })
	keyPackage!: string;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "used_at", type: "timestamptz", nullable: true })
	usedAt!: Date | null;
}

/** An MLS Welcome stored for one claimed key package of a device. */
@Entity("chat_mls_welcomes")
@Unique("uq_chat_mls_welcomes_key_package", ["conversationId", "keyPackageId"])
@Index("idx_chat_mls_welcomes_device", ["deviceId", "createdAt"], { where: `"consumed_at" IS NULL` })
export class ChatMlsWelcome {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "pk_chat_mls_welcomes" })
	id!: string;

	@Column({ name: "conversation_id", type: "uuid" })
	conversationId!: string;

	@ManyToOne(() => ChatConversation, { onDelete: "CASCADE" })
	@JoinColumn({ name: "conversation_id", foreignKeyConstraintName: "fk_chat_mls_welcomes_conversation" })
	conversation?: ChatConversation;

	@Column({ name: "device_id", type: "uuid" })
	deviceId!: string;

	@ManyToOne(() => ChatMlsDevice, { onDelete: "CASCADE" })
	@JoinColumn({ name: "device_id", foreignKeyConstraintName: "fk_chat_mls_welcomes_device" })
	device?: ChatMlsDevice;

	@Column({ name: "key_package_id", type: "uuid" })
	keyPackageId!: string;

	@ManyToOne(() => ChatMlsKeyPackage, { onDelete: "CASCADE" })
	@JoinColumn({ name: "key_package_id", foreignKeyConstraintName: "fk_chat_mls_welcomes_key_package" })
	keyPackage?: ChatMlsKeyPackage;

	@Column({ name: "message_id", type: "uuid" })
	messageId!: string;

	@ManyToOne(() => ChatMessage, { onDelete: "CASCADE" })
	@JoinColumn({ name: "message_id", foreignKeyConstraintName: "fk_chat_mls_welcomes_message" })
	message?: ChatMessage;

	@Column({ type: "text" })
	welcome!: string;

	@Column({ name: "ratchet_tree", type: "text" })
	ratchetTree!: string;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "consumed_at", type: "timestamptz", nullable: true })
	consumedAt!: Date | null;
}

/** A user's encrypted chat history backup (one row per user). */
@Entity("chat_mls_history_backups")
export class ChatMlsHistoryBackup {

	@PrimaryColumn({ name: "user_id", type: "uuid", primaryKeyConstraintName: "pk_chat_mls_history_backups" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "fk_chat_mls_history_backups_user" })
	user?: User;

	@Column({ type: "text" })
	backup!: string;

	@Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
	updatedAt!: Date;
}
