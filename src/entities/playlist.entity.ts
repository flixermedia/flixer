import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** A user's own ordered list of songs. */
@Entity("playlists")
@Index("idx_playlists_user", ["userId"])
export class Playlist {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	@Column({ type: "varchar", length: 500, nullable: true })
	description!: string | null;

	/** Public playlists show on the owner's profile and can be opened by other users while the profile is visible. */
	@Column({ name: "is_public", type: "boolean", default: true })
	isPublic!: boolean;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
