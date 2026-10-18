import { Column, Entity, Index, PrimaryColumn } from "typeorm";

export type PasskeyChallengeType = "registration" | "authentication";

@Entity("passkey_challenges")
@Index("IDX_passkey_challenges_expires_at", ["expiresAt"])
export class PasskeyChallenge {

	@PrimaryColumn({ type: "varchar", length: 255 })
	challenge!: string;

	@Column({ type: "varchar", length: 16 })
	type!: PasskeyChallengeType;

	@Column({ name: "user_id", type: "uuid", nullable: true })
	userId!: string | null;

	@Column({ name: "expires_at", type: "timestamptz" })
	expiresAt!: Date;
}
