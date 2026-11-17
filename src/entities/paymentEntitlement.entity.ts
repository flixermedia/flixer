import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";
import type { ContentScope } from "../api/payments/paymentTypes.js";

export type EntitlementSource = "purchase" | "rental" | "registration" | "admin";

/** Access to a scope of content. Rentals expire; a rental that starts on first play is activated by its first playback. */
@Entity("payment_entitlements")
export class PaymentEntitlement {

	@PrimaryColumn("uuid")
	id!: string;

	@Index()
	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ type: "varchar", length: 16 })
	source!: EntitlementSource;

	@Column({ name: "order_id", type: "uuid", nullable: true })
	orderId!: string | null;

	@Column({ type: "jsonb" })
	scope!: ContentScope;

	@Column({ name: "expires_at", type: "timestamptz", nullable: true })
	expiresAt!: Date | null;

	/** For first-play rentals: the last moment the rental can still be started. */
	@Column({ name: "claim_until", type: "timestamptz", nullable: true })
	claimUntil!: Date | null;

	@Column({ name: "rental_hours", type: "int", nullable: true })
	rentalHours!: number | null;

	@Column({ name: "activated_at", type: "timestamptz", nullable: true })
	activatedAt!: Date | null;

	@Column({ name: "revoked_at", type: "timestamptz", nullable: true })
	revokedAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
