import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("external_identities")
@Index("IDX_external_identities_user", ["userId"])
export class ExternalIdentity {
	@PrimaryColumn({ name: "plugin_id", type: "varchar", length: 128 })
	pluginId!: string;

	@PrimaryColumn({ name: "provider_key", type: "varchar", length: 36, default: "" })
	providerKey!: string;

	@PrimaryColumn({ name: "identity_hash", type: "varchar", length: 64 })
	identityHash!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}