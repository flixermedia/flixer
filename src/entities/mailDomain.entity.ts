import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export interface MailDomainDnsCheck {
	ok: boolean;
	detail: string;
}

export type MailDomainDnsChecks = Partial<Record<"ownership" | "mx" | "spf" | "dkim" | "dmarc", MailDomainDnsCheck>>;

/** A sending/receiving domain. When `allowSubdomains` is set the domain also covers every subdomain. */
@Entity("mail_domains")
export class MailDomain {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 253, unique: true })
	domain!: string;

	@Column({ name: "allow_subdomains", type: "boolean", default: false })
	allowSubdomains!: boolean;

	@Column({ name: "verification_token", type: "varchar", length: 64 })
	verificationToken!: string;

	@Column({ name: "verified_at", type: "timestamptz", nullable: true })
	verifiedAt!: Date | null;

	@Column({ name: "dkim_selector", type: "varchar", length: 63 })
	dkimSelector!: string;

	@Column({ name: "dkim_public_key", type: "text" })
	dkimPublicKey!: string;

	/** AES-256-GCM encrypted PEM; never returned by the API. */
	@Column({ name: "dkim_private_key", type: "text" })
	dkimPrivateKey!: string;

	@Column({ name: "dns_checks", type: "jsonb", default: () => "'{}'" })
	dnsChecks!: MailDomainDnsChecks;

	@Column({ name: "last_checked_at", type: "timestamptz", nullable: true })
	lastCheckedAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
