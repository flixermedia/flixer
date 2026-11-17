import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";
import type { ThemeConfig } from "../api/appearance/themeSchema.js";

/** A snapshot of a custom theme taken just before it was changed, so an admin can roll back. */
@Entity("theme_versions")
export class ThemeVersion {
	@PrimaryColumn({ type: "uuid" })
	id!: string;

	@Index()
	@Column({ name: "theme_id", type: "uuid" })
	themeId!: string;

	@Column({ type: "varchar", length: 60 })
	name!: string;

	@Column({ type: "varchar", length: 240, default: "" })
	description!: string;

	@Column({ type: "jsonb" })
	config!: ThemeConfig;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
