import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type PluginStorageScope = "plugin" | "user";
export type PluginStorageJsonValue =
	null | boolean | number | string | PluginStorageJsonValue[] | { [key: string]: PluginStorageJsonValue };

@Entity("plugin_storage")
export class PluginStorageEntry {
	@PrimaryColumn({ name: "plugin_id", type: "varchar", length: 128 })
	pluginId!: string;

	@PrimaryColumn({ type: "varchar", length: 8 })
	scope!: PluginStorageScope;

	@PrimaryColumn({ name: "owner_id", type: "varchar", length: 128 })
	ownerId!: string;

	@PrimaryColumn({ type: "varchar", length: 128 })
	key!: string;

	@Column({ type: "jsonb" })
	value!: PluginStorageJsonValue;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
