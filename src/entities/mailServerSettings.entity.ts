import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type UserAddressMode = "username" | "random";

/** Singleton row (id = 1) holding the built-in mail server configuration. */
@Entity("mail_server_settings")
export class MailServerSettings {

	@PrimaryColumn({ type: "smallint", default: 1 })
	id!: number;

	@Column({ name: "inbound_enabled", type: "boolean", default: false })
	inboundEnabled!: boolean;

	@Column({ name: "inbound_port", type: "integer", default: 2525 })
	inboundPort!: number;

	/** Name announced in EHLO; should match the server's reverse DNS (PTR) record. */
	@Column({ type: "varchar", length: 253, nullable: true })
	hostname!: string | null;

	@Column({ name: "max_message_mb", type: "integer", default: 10 })
	maxMessageMb!: number;

	@Column({ name: "outbound_enabled", type: "boolean", default: false })
	outboundEnabled!: boolean;

	/** Retry through the external SMTP relay (smtp_* settings) when direct delivery fails permanently. */
	@Column({ name: "relay_fallback", type: "boolean", default: false })
	relayFallback!: boolean;

	@Column({ name: "noreply_address", type: "varchar", length: 320, nullable: true })
	noreplyAddress!: string | null;

	@Column({ name: "noreply_name", type: "varchar", length: 100, default: "Flixer" })
	noreplyName!: string;

	@Column({ name: "user_addresses_enabled", type: "boolean", default: false })
	userAddressesEnabled!: boolean;

	@Column({ name: "user_address_mode", type: "varchar", length: 8, default: "username" })
	userAddressMode!: UserAddressMode;

	@Column({ name: "user_address_domain", type: "varchar", length: 253, nullable: true })
	userAddressDomain!: string | null;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
