import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "./user.entity.js";

// Constraint names are the PostgreSQL defaults of the hand-written migrations (oidc_*_pkey, *_fkey).
// The jsonb-expression indexes IDX_oidc_artifacts_{grant,uid,user_code} exist only in the migrations.

@Entity("oidc_clients")
export class OidcClient {

	@PrimaryColumn({ type: "varchar", length: 64, primaryKeyConstraintName: "oidc_clients_pkey" })
	id!: string;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	@Column({ name: "redirect_uris", type: "jsonb" })
	redirectUris!: string[];

	@Column({ name: "secret_encrypted", type: "text", nullable: true })
	secretEncrypted!: string | null;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "resource_scopes", type: "text", array: true, default: () => "ARRAY[]::text[]" })
	resourceScopes!: string[];
}

@Entity("oidc_artifacts")
@Index("IDX_oidc_artifacts_expiry", ["expiresAt"])
export class OidcArtifact {

	@PrimaryColumn({ type: "varchar", length: 64, primaryKeyConstraintName: "oidc_artifacts_pkey" })
	kind!: string;

	@PrimaryColumn({ type: "varchar", length: 255, primaryKeyConstraintName: "oidc_artifacts_pkey" })
	id!: string;

	@Column({ type: "jsonb" })
	payload!: Record<string, unknown>;

	@Column({ name: "expires_at", type: "timestamptz", nullable: true })
	expiresAt!: Date | null;
}

@Entity("oidc_config")
export class OidcConfig {

	@PrimaryColumn({ type: "varchar", length: 64, primaryKeyConstraintName: "oidc_config_pkey" })
	key!: string;

	@Column({ type: "text" })
	value!: string;
}

@Entity("oidc_consents")
export class OidcConsent {

	@PrimaryColumn({ name: "account_id", type: "uuid", primaryKeyConstraintName: "oidc_consents_pkey" })
	accountId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "account_id", foreignKeyConstraintName: "oidc_consents_account_id_fkey" })
	account?: User;

	@PrimaryColumn({ name: "client_id", type: "varchar", length: 64, primaryKeyConstraintName: "oidc_consents_pkey" })
	clientId!: string;

	@ManyToOne(() => OidcClient, { onDelete: "CASCADE" })
	@JoinColumn({ name: "client_id", foreignKeyConstraintName: "oidc_consents_client_id_fkey" })
	client?: OidcClient;

	@Column({ type: "text", array: true })
	scopes!: string[];

	@Column({ type: "text", array: true })
	claims!: string[];
}
