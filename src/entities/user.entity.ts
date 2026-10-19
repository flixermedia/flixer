import { Column, CreateDateColumn, Entity, OneToOne, PrimaryColumn } from "typeorm";
import { UserPreference } from "./userPreference.entity.js";

export type UserRole = "admin" | "user";

@Entity("users")
export class User {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 64, unique: true })
	username!: string;

	@Column({ name: "display_name", type: "varchar", length: 64, nullable: true })
	displayName!: string | null;

	@Column({ type: "varchar", length: 254, unique: true, nullable: true })
	email!: string | null;

	@Column({ type: "varchar", length: 16, default: "user" })
	role!: UserRole;

	@Column({ name: "password_hash", type: "varchar", length: 255 })
	passwordHash!: string;

	@Column({ name: "email_verified_at", type: "timestamptz", nullable: true })
	emailVerifiedAt!: Date | null;

	@Column({ name: "pending_email", type: "varchar", length: 254, nullable: true })
	pendingEmail!: string | null;

	/** Loaded with every user query. Null until the user has a preferences row (defaults apply). */
	@OneToOne(() => UserPreference, (preference) => preference.user, { eager: true })
	preferences?: UserPreference | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
