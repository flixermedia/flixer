import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "./user.entity.js";

// Constraint and index names are the ones created by the hand-written migrations.

/** A friend request or accepted friendship; the user ids are stored in sorted order (low < high). */
@Entity("social_friendships")
@Check("ck_social_friendships_order", `"user_low_id" < "user_high_id"`)
@Check("ck_social_friendships_requester", `"requested_by" IN ("user_low_id", "user_high_id")`)
@Index("idx_social_friendships_high_pending", ["userHighId", "createdAt"], { where: `"accepted_at" IS NULL` })
export class SocialFriendship {

	@PrimaryColumn({ name: "user_low_id", type: "uuid", primaryKeyConstraintName: "pk_social_friendships" })
	userLowId!: string;

	@PrimaryColumn({ name: "user_high_id", type: "uuid", primaryKeyConstraintName: "pk_social_friendships" })
	userHighId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_low_id", foreignKeyConstraintName: "fk_social_friendships_low" })
	userLow?: User;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_high_id", foreignKeyConstraintName: "fk_social_friendships_high" })
	userHigh?: User;

	@Column({ name: "requested_by", type: "uuid" })
	requestedBy!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "requested_by", foreignKeyConstraintName: "fk_social_friendships_requester" })
	requester?: User;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "accepted_at", type: "timestamptz", nullable: true })
	acceptedAt!: Date | null;
}

/** A shareable friend-invite link owned by one user. */
@Entity("social_friend_invites")
@Check("ck_social_friend_invites_max_uses", `"max_uses" IS NULL OR "max_uses" > 0`)
@Check("ck_social_friend_invites_use_count", `"use_count" >= 0`)
export class SocialFriendInvite {

	@PrimaryColumn({ type: "varchar", length: 36, primaryKeyConstraintName: "pk_social_friend_invites" })
	token!: string;

	@Column({ name: "owner_id", type: "uuid" })
	ownerId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "owner_id", foreignKeyConstraintName: "fk_social_friend_invites_owner" })
	owner?: User;

	@Column({ name: "max_uses", type: "integer", nullable: true })
	maxUses!: number | null;

	@Column({ name: "use_count", type: "integer", default: 0 })
	useCount!: number;

	@Column({ name: "expires_at", type: "timestamptz", nullable: true })
	expiresAt!: Date | null;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;
}
