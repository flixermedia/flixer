import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** A card on file. Only the brand, last four digits and expiry are kept; the provider holds the card itself. */
@Entity("payment_methods")
export class PaymentMethod {

	@PrimaryColumn("uuid")
	id!: string;

	@Index()
	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ type: "varchar", length: 16 })
	provider!: string;

	@Column({ name: "provider_ref", type: "varchar", length: 128 })
	providerRef!: string;

	@Column({ type: "varchar", length: 32 })
	brand!: string;

	@Column({ type: "varchar", length: 4 })
	last4!: string;

	@Column({ name: "exp_month", type: "int" })
	expMonth!: number;

	@Column({ name: "exp_year", type: "int" })
	expYear!: number;

	@Column({ name: "is_default", type: "boolean", default: false })
	isDefault!: boolean;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
