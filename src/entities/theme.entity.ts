import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { ThemeConfig } from "../api/appearance/themeSchema.js";

/** A selectable look for the whole app. Built-in rows are read-only; admins can create and import more. */
@Entity("themes")
export class Theme {
	@PrimaryColumn({ type: "uuid" })
	id!: string;

	@Column({ type: "varchar", length: 60 })
	name!: string;

	@Column({ type: "varchar", length: 240, default: "" })
	description!: string;

	@Column({ name: "is_built_in", type: "boolean", default: false })
	isBuiltIn!: boolean;

	@Column({ type: "jsonb" })
	config!: ThemeConfig;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
