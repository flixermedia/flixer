import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("passkey_credentials")
@Index("IDX_passkey_credentials_user_id", ["userId"])
export class PasskeyCredential {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ name: "credential_id", type: "varchar", length: 1024, unique: true })
	credentialId!: string;

	@Column({ name: "public_key", type: "bytea" })
	publicKey!: Buffer;

	@Column({
		type: "bigint",
		default: 0,
		transformer: { to: (value: number) => value, from: (value: string | number) => Number(value) },
	})
	counter!: number;

	@Column({ type: "simple-json", nullable: true })
	transports!: string[] | null;

	@Column({ name: "device_type", type: "varchar", length: 32 })
	deviceType!: string;

	@Column({ name: "backed_up", type: "boolean", default: false })
	backedUp!: boolean;

	@Column({ type: "varchar", length: 64 })
	name!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@Column({ name: "last_used_at", type: "timestamptz", nullable: true })
	lastUsedAt!: Date | null;
}
