import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { PluginRepositoryManifest } from "../api/plugins/repositoryManifest.js";

@Entity("plugin_repositories")
@Index("uq_plugin_repositories_url", ["url"], { unique: true })
export class PluginRepository {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 120 })
	name!: string;

	@Column({ type: "varchar", length: 2048 })
	url!: string;

	@Column({ name: "is_official", type: "boolean", default: false })
	isOfficial!: boolean;

	@Column({ type: "boolean", default: true })
	enabled!: boolean;

	@Column({ name: "last_checked_at", type: "timestamptz", nullable: true })
	lastCheckedAt!: Date | null;

	@Column({ name: "last_error", type: "text", nullable: true })
	lastError!: string | null;

	@Column({ type: "jsonb", nullable: true })
	manifest!: PluginRepositoryManifest | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
