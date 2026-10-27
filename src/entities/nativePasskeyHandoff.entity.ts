import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("native_passkey_handoffs")
@Index("IDX_native_passkey_handoffs_expires_at", ["expiresAt"])
export class NativePasskeyHandoff {

	@PrimaryColumn({ name: "id_hash", type: "varchar", length: 64 })
	idHash!: string;

	@Column({ name: "code_hash", type: "varchar", length: 64, nullable: true, unique: true })
	codeHash!: string | null;

	@Column({ name: "code_challenge", type: "varchar", length: 43 })
	codeChallenge!: string;

	@Column({ type: "varchar", length: 64 })
	state!: string;

	@Column({ name: "user_id", type: "uuid", nullable: true })
	userId!: string | null;

	@Column({ name: "expires_at", type: "timestamptz" })
	expiresAt!: Date;
}
