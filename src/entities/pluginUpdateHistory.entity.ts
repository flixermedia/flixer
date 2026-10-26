import { CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Column } from "typeorm";

export type PluginUpdateAction = "install" | "update";
export type PluginUpdateOutcome = "succeeded" | "failed";

@Entity("plugin_update_history")
@Index("idx_plugin_update_history_plugin_created", ["pluginId", "createdAt"])
export class PluginUpdateHistory {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({ name: "plugin_id", type: "varchar", length: 128 })
	pluginId!: string;

	@Column({ type: "varchar", length: 16 })
	action!: PluginUpdateAction;

	@Column({ name: "from_version", type: "varchar", length: 64, nullable: true })
	fromVersion!: string | null;

	@Column({ name: "to_version", type: "varchar", length: 64 })
	toVersion!: string;

	@Column({ type: "varchar", length: 16 })
	outcome!: PluginUpdateOutcome;

	@Column({ name: "error_message", type: "text", nullable: true })
	errorMessage!: string | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
