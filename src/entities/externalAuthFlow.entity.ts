import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("external_auth_flows")
@Index("IDX_external_auth_flows_expires", ["expiresAt"])
export class ExternalAuthFlow {
	@PrimaryColumn({ name: "state_hash", type: "varchar", length: 64 })
	stateHash!: string;

	@Column({ name: "browser_hash", type: "varchar", length: 64 })
	browserHash!: string;

	@Column({ name: "nonce_hash", type: "varchar", length: 64, nullable: true })
	nonceHash!: string | null;

	@Column({ name: "plugin_id", type: "varchar", length: 128 })
	pluginId!: string;

	@Column({ name: "provider_key", type: "varchar", length: 36, default: "" })
	providerKey!: string;

	@Column({ name: "provider_revision", type: "uuid", nullable: true })
	providerRevision!: string | null;

	@Column({ name: "user_id", type: "uuid", nullable: true })
	userId!: string | null;

	@Column({ name: "verifier_cipher", type: "text" })
	verifierCipher!: string;

	@Column({ name: "redirect_uri", type: "text" })
	redirectUri!: string;

	@Column({ name: "expires_at", type: "timestamptz" })
	expiresAt!: Date;
}