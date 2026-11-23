import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { InviteServer } from "./inviteServer.entity.js";
import type { LibraryAccessMode } from "./userAccessPolicy.entity.js";

/**
 * An invitation an administrator hands out. Redeeming it creates a Flixer account even when
 * public registration is off, and can additionally create an account on a linked media server.
 */
@Entity("invitations")
@Index("UQ_invitations_code", ["code"], { unique: true })
export class Invitation {
	@PrimaryColumn("uuid")
	id!: string;

	/** The code in the invite link. Stored upper-case; lookups normalise the same way. */
	@Column({ type: "varchar", length: 64 })
	code!: string;

	@Column({ type: "varchar", length: 100, nullable: true })
	label!: string | null;

	/** The media server to also create an account on; null invites to this Flixer installation only. */
	@Column({ name: "server_id", type: "uuid", nullable: true })
	serverId!: string | null;

	@ManyToOne(() => InviteServer, { onDelete: "CASCADE", eager: true })
	@JoinColumn({ name: "server_id" })
	server?: InviteServer | null;

	/** How often the invitation can be redeemed; null means unlimited. */
	@Column({ name: "max_uses", type: "int", nullable: true })
	maxUses!: number | null;

	@Column({ name: "used_count", type: "int", default: 0 })
	usedCount!: number;

	@Column({ name: "expires_at", type: "timestamptz", nullable: true })
	expiresAt!: Date | null;

	@Column({ type: "boolean", default: false })
	disabled!: boolean;

	/** Flixer library access applied to the new account, mirroring user access policies. */
	@Column({ name: "library_mode", type: "varchar", length: 16, default: "all" })
	libraryMode!: LibraryAccessMode;

	@Column({ name: "library_ids", type: "jsonb", default: () => "'[]'" })
	libraryIds!: string[];

	/** Jellyfin/Emby folder ids or Plex section ids granted on the linked server; empty grants all. */
	@Column({ name: "external_library_ids", type: "jsonb", default: () => "'[]'" })
	externalLibraryIds!: string[];

	/** Jellyfin/Emby content downloading and Plex sync for the created account. */
	@Column({ name: "allow_downloads", type: "boolean", default: true })
	allowDownloads!: boolean;

	/** Lets this invitation skip the card and registration fee even while payments are active. */
	@Column({ name: "skip_payment", type: "boolean", default: false })
	skipPayment!: boolean;

	/** Lets this invitation skip email verification even when Flixer requires it globally. */
	@Column({ name: "skip_email_verification", type: "boolean", default: false })
	skipEmailVerification!: boolean;

	/** Opts invited Plex users out of Plex's built-in ad-supported online media sources when they sign in with Plex. */
	@Column({ name: "disable_plex_online_sources", type: "boolean", default: false })
	disablePlexOnlineSources!: boolean;

	/** Days until the created Flixer account is disabled again; null means it never expires. */
	@Column({ name: "user_expires_in_days", type: "int", nullable: true })
	userExpiresInDays!: number | null;

	@Column({ name: "created_by", type: "uuid", nullable: true })
	createdBy!: string | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
