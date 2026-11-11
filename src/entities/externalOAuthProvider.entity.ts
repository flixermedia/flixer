import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("external_oauth_providers")
@Index("IDX_external_oauth_providers_plugin", ["pluginId"])
export class ExternalOAuthProvider {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({ name: "plugin_id", type: "varchar", length: 128 })
	pluginId!: string;

	@Column({ type: "varchar", length: 128 })
	name!: string;

	@Column({ type: "boolean", default: false })
	enabled!: boolean;

	@Column({ type: "jsonb" })
	settings!: Record<string, string>;

	@Column({ name: "secret_cipher", type: "text", nullable: true })
	secretCipher!: string | null;

	@Column({ name: "revision", type: "uuid" })
	revision!: string;
}