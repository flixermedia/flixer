import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { InviteServer } from "./inviteServer.entity.js";
import { User } from "./user.entity.js";

export type LinkedAccountStatus = "pending_payment" | "pending_verification" | "completed" | "failed";

/**
 * Links an external media server account (Jellyfin, Emby, or Plex) to its defining Flixer User.
 * One row per (userId, serverId).
 */
@Entity("user_linked_accounts")
@Index("UQ_user_linked_accounts_pair", ["userId", "serverId"], { unique: true })
@Index("IDX_user_linked_accounts_user", ["userId"])
@Index("IDX_user_linked_accounts_server", ["serverId"])
export class UserLinkedAccount {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user?: User;

	@Column({ name: "server_id", type: "uuid" })
	serverId!: string;

	@ManyToOne(() => InviteServer, { onDelete: "CASCADE", eager: true })
	@JoinColumn({ name: "server_id" })
	server?: InviteServer;

	@Column({ name: "external_user_id", type: "varchar", length: 128, nullable: true })
	externalUserId!: string | null;

	@Column({ name: "external_username", type: "varchar", length: 128, nullable: true })
	externalUsername!: string | null;

	@Column({ name: "external_email", type: "varchar", length: 254, nullable: true })
	externalEmail!: string | null;

	@Column({ type: "varchar", length: 32, default: "completed" })
	status!: LinkedAccountStatus;

	@Column({ type: "text", nullable: true })
	error!: string | null;

	@Column({ name: "pending_credentials", type: "text", nullable: true })
	pendingCredentials!: string | null;

	@Column({ name: "last_synced_at", type: "timestamptz", nullable: true })
	lastSyncedAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
