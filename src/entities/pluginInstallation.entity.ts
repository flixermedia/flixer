import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { PluginManifest } from "../api/plugins/pluginManifest.js";

export type PluginInstallationStatus =
	"installed" | "initializing" | "enabled" | "running" | "disabled" | "error" | "updating";

@Entity("plugin_installations")
@Index("idx_plugin_installations_repository", ["repositoryId"])
export class PluginInstallation {
	@PrimaryColumn({ name: "plugin_id", type: "varchar", length: 128 })
	pluginId!: string;

	@Column({ name: "repository_id", type: "uuid", nullable: true })
	repositoryId!: string | null;

	@Column({ type: "varchar", length: 64 })
	version!: string;

	@Column({ name: "package_digest", type: "varchar", length: 64 })
	packageDigest!: string;

	@Column({ name: "install_path", type: "text" })
	installPath!: string;

	@Column({ type: "jsonb" })
	manifest!: PluginManifest;

	@Column({ type: "varchar", length: 16, default: "installed" })
	status!: PluginInstallationStatus;

	@Column({ type: "boolean", default: false })
	enabled!: boolean;

	@Column({ name: "approved_permissions", type: "jsonb", default: () => "'[]'::jsonb" })
	approvedPermissions!: string[];

	@Column({ type: "jsonb", default: () => "'{}'::jsonb" })
	settings!: Record<string, unknown>;

	@Column({ name: "encrypted_secrets", type: "jsonb", default: () => "'{}'::jsonb" })
	encryptedSecrets!: Record<string, string>;

	@Column({ name: "target_status", type: "jsonb", default: () => "'{}'::jsonb" })
	targetStatus!: Record<string, string>;

	@Column({ name: "last_error", type: "text", nullable: true })
	lastError!: string | null;

	@CreateDateColumn({ name: "installed_at", type: "timestamptz" })
	installedAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
