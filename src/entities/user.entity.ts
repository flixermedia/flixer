import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

export type UserRole = "admin" | "user";

@Entity("users")
export class User {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 64, unique: true })
	username!: string;

	@Column({ type: "varchar", length: 254, unique: true, nullable: true })
	email!: string | null;

	@Column({ type: "varchar", length: 16, default: "user" })
	role!: UserRole;

	@Column({ name: "password_hash", type: "varchar", length: 255 })
	passwordHash!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
