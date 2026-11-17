import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";
import type { Price } from "../api/payments/paymentTypes.js";

@Entity("payment_coupons")
export class PaymentCoupon {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 64, unique: true })
	code!: string;

	@Column({ type: "text", nullable: true })
	description!: string | null;

	@Column({ name: "percent_off", type: "int", nullable: true })
	percentOff!: number | null;

	@Column({ name: "amount_off", type: "jsonb", nullable: true })
	amountOff!: Price[] | null;

	@Column({ name: "max_redemptions", type: "int", nullable: true })
	maxRedemptions!: number | null;

	@Column({ type: "int", default: 0 })
	redeemed!: number;

	@Column({ name: "expires_at", type: "timestamptz", nullable: true })
	expiresAt!: Date | null;

	/** Empty means the coupon works on everything. */
	@Column({ name: "product_ids", type: "jsonb", default: () => "'[]'" })
	productIds!: string[];

	@Column({ name: "plan_ids", type: "jsonb", default: () => "'[]'" })
	planIds!: string[];

	@Column({ type: "boolean", default: true })
	active!: boolean;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
