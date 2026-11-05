import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { SubscriptionStatus } from "../api/payments/paymentTypes.js";

/** Renewals are charged by Flixer against the saved card, so Stripe and Square behave the same way. */
@Entity("payment_subscriptions")
export class PaymentSubscription {

	@PrimaryColumn("uuid")
	id!: string;

	@Index()
	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ name: "plan_id", type: "uuid" })
	planId!: string;

	@Column({ type: "varchar", length: 16 })
	status!: SubscriptionStatus;

	@Column({ type: "varchar", length: 3 })
	currency!: string;

	/** The recurring price before tax, locked when the user subscribed. */
	@Column({ name: "amount_minor", type: "int" })
	amountMinor!: number;

	@Column({ name: "period_end", type: "timestamptz" })
	periodEnd!: Date;

	@Column({ name: "cancel_at_period_end", type: "boolean", default: false })
	cancelAtPeriodEnd!: boolean;

	@Column({ name: "failed_attempts", type: "int", default: 0 })
	failedAttempts!: number;

	@Column({ name: "next_attempt_at", type: "timestamptz", nullable: true })
	nextAttemptAt!: Date | null;

	@Column({ name: "grace_until", type: "timestamptz", nullable: true })
	graceUntil!: Date | null;

	@Column({ name: "canceled_at", type: "timestamptz", nullable: true })
	canceledAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
