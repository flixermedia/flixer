import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type PaymentOrderKind = "registration" | "purchase" | "rental" | "subscription";
export type PaymentOrderStatus = "pending" | "requires_action" | "paid" | "failed" | "refunded" | "partially_refunded";

@Entity("payment_orders")
export class PaymentOrder {

	@PrimaryColumn("uuid")
	id!: string;

	@Index()
	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ type: "varchar", length: 16 })
	kind!: PaymentOrderKind;

	@Column({ name: "product_id", type: "uuid", nullable: true })
	productId!: string | null;

	@Column({ name: "plan_id", type: "uuid", nullable: true })
	planId!: string | null;

	@Column({ name: "subscription_id", type: "uuid", nullable: true })
	subscriptionId!: string | null;

	@Column({ type: "text" })
	description!: string;

	@Column({ type: "varchar", length: 3 })
	currency!: string;

	@Column({ name: "subtotal_minor", type: "int" })
	subtotalMinor!: number;

	@Column({ name: "discount_minor", type: "int", default: 0 })
	discountMinor!: number;

	@Column({ name: "tax_minor", type: "int", default: 0 })
	taxMinor!: number;

	@Column({ name: "total_minor", type: "int" })
	totalMinor!: number;

	@Column({ name: "coupon_code", type: "varchar", length: 64, nullable: true })
	couponCode!: string | null;

	@Column({ type: "varchar", length: 24 })
	status!: PaymentOrderStatus;

	@Column({ type: "varchar", length: 16, nullable: true })
	provider!: string | null;

	@Index()
	@Column({ name: "provider_ref", type: "varchar", length: 128, nullable: true })
	providerRef!: string | null;

	@Column({ name: "refunded_minor", type: "int", default: 0 })
	refundedMinor!: number;

	@Column({ type: "text", nullable: true })
	failure!: string | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
