import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Invitation } from "./invitation.entity.js";

/** "pending_payment" until the signup fee clears; "pending_verification" until email is verified; "failed" when the media server refused the account. */
export type InvitationUsageStatus = "pending_payment" | "pending_verification" | "completed" | "failed";

/** One redemption of an invitation. */
@Entity("invitation_usages")
@Index("IDX_invitation_usages_invitation", ["invitationId"])
@Index("IDX_invitation_usages_user", ["userId"])
export class InvitationUsage {
	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "invitation_id", type: "uuid" })
	invitationId!: string;

	@ManyToOne(() => Invitation, { onDelete: "CASCADE" })
	@JoinColumn({ name: "invitation_id" })
	invitation?: Invitation;

	/** The Flixer account the redemption created; cleared when that account is deleted. */
	@Column({ name: "user_id", type: "uuid", nullable: true })
	userId!: string | null;

	@Column({ type: "varchar", length: 64 })
	username!: string;

	@Column({ type: "varchar", length: 32, default: "completed" })
	status!: InvitationUsageStatus;

	/** The account id created on the linked Jellyfin or Emby server. */
	@Column({ name: "external_user_id", type: "varchar", length: 128, nullable: true })
	externalUserId!: string | null;

	/** The address a Plex invite was sent to. */
	@Column({ name: "external_email", type: "varchar", length: 254, nullable: true })
	externalEmail!: string | null;

	/** Why provisioning on the media server failed, for the admin usage list. */
	@Column({ type: "text", nullable: true })
	error!: string | null;

	/**
	 * AES-256-GCM-encrypted credentials held only while payment is pending, because the linked
	 * media server needs the chosen password once the fee clears. Erased on fulfillment.
	 */
	@Column({ name: "pending_credentials", type: "text", nullable: true })
	pendingCredentials!: string | null;

	/** When the created Flixer account gets disabled again; null means it never expires. */
	@Column({ name: "expires_at", type: "timestamptz", nullable: true })
	expiresAt!: Date | null;

	/** When the expiry job acted on this redemption, so a re-enabled account is not disabled again. */
	@Column({ name: "user_disabled_at", type: "timestamptz", nullable: true })
	userDisabledAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
