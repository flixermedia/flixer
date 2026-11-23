import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export const INVITE_SERVER_TYPES = ["jellyfin", "emby", "plex", "other"] as const;
export type InviteServerType = (typeof INVITE_SERVER_TYPES)[number];

/**
 * A media server invitations can create accounts on. Flixer itself is not listed here: an
 * invitation without a server targets this Flixer installation.
 */
@Entity("invite_servers")
@Index("UQ_invite_servers_name", ["name"], { unique: true })
export class InviteServer {
	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	@Column({ type: "varchar", length: 16 })
	type!: InviteServerType;

	/** Base URL of the server used by Flixer to communicate with it. */
	@Column({ type: "varchar", length: 500 })
	url!: string;

	/** Optional public URL invited users are sent to when clicking Open Plex/Jellyfin/etc.; falls back to `url` when empty. */
	@Column({ name: "external_url", type: "varchar", length: 500, nullable: true })
	externalUrl!: string | null;

	/** Jellyfin/Emby API key or Plex token. AES-256-GCM, see inviteSecrets.ts. Never returned by the API. */
	@Column({ name: "api_key_encrypted", type: "text", nullable: true })
	apiKeyEncrypted!: string | null;

	/** Shown to the invited person after they join, for example how to install an app. */
	@Column({ type: "text", nullable: true })
	instructions!: string | null;

	@Column({ type: "boolean", default: true })
	enabled!: boolean;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
