import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { ContentScope, Price, RentalStart } from "../api/payments/paymentTypes.js";

/** Something sold once: buying keeps access for good, renting gives access for a window. */
@Entity("payment_products")
export class PaymentProduct {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 200 })
	name!: string;

	@Column({ type: "text", nullable: true })
	description!: string | null;

	@Column({ type: "varchar", length: 8 })
	kind!: "buy" | "rent";

	@Column({ type: "jsonb" })
	scope!: ContentScope;

	@Column({ type: "jsonb", default: () => "'[]'" })
	prices!: Price[];

	@Column({ name: "rental_hours", type: "int", nullable: true })
	rentalHours!: number | null;

	@Column({ name: "rental_start", type: "varchar", length: 16, default: "purchase" })
	rentalStart!: RentalStart;

	/** When set, only a direct purchase of this product (or a narrower grant) unlocks its content; blanket access from signup or subscriptions does not. */
	@Column({ name: "requires_purchase", type: "boolean", default: false })
	requiresPurchase!: boolean;

	@Column({ name: "ads_exempt", type: "boolean", default: false })
	adsExempt!: boolean;

	@Column({ type: "boolean", default: true })
	active!: boolean;

	@Column({ name: "sort_order", type: "int", default: 0 })
	sortOrder!: number;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
