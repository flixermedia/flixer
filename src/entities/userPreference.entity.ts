import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { User } from "./user.entity.js";

/**
 * Per-user settings. `data` holds free-form frontend preferences (language, UI options, ...).
 * `passkeyRequired` and `avatarFile` are server-managed and never writable through the preferences API.
 */
@Entity("user_preferences")
export class UserPreference {
	@PrimaryColumn({ name: "user_id", type: "uuid" })
	userId!: string;

	@OneToOne(() => User, (user) => user.preferences, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user?: User;

	@Column({ type: "jsonb", default: () => "'{}'::jsonb" })
	data!: Record<string, unknown>;

	@Column({ name: "passkey_required", type: "boolean", default: false })
	passkeyRequired!: boolean;

	@Column({ name: "avatar_file", type: "varchar", length: 128, nullable: true })
	avatarFile!: string | null;

	/** Controls who can discover and view the user's profile. */
	@Column({ name: "profile_visibility", type: "varchar", length: 16, default: "public" })
	profileVisibility!: "public" | "hidden" | "friends";

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
