import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** An encrypted value a plugin keeps for itself, such as the API key of a service an administrator connected. */
@Entity("plugin_secrets")
export class PluginSecret {
	@PrimaryColumn({ name: "plugin_id", type: "varchar", length: 128 })
	pluginId!: string;

	@PrimaryColumn({ type: "varchar", length: 128 })
	name!: string;

	@Column({ type: "text" })
	value!: string;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
