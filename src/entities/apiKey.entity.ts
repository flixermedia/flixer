import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "./user.entity.js";

@Entity("api_keys")
@Index("IDX_api_keys_user_id", ["userId"])
export class ApiKey {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user?: User;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	/** The first characters of the key, kept so it can be recognised in the list. */
	@Column({ type: "varchar", length: 16 })
	prefix!: string;

	/** SHA-256 of the key; the key itself is shown once and never stored. */
	@Column({ name: "key_hash", type: "varchar", length: 64, unique: true })
	keyHash!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@Column({ name: "last_used_at", type: "timestamptz", nullable: true })
	lastUsedAt!: Date | null;
}
