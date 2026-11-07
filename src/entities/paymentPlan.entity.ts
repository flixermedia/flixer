import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { ContentScope, PlanInterval, Price } from "../api/payments/paymentTypes.js";

/** A recurring subscription tier that unlocks a set of content scopes. */
@Entity("payment_plans")
export class PaymentPlan {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 200 })
	name!: string;

	@Column({ type: "text", nullable: true })
	description!: string | null;

	@Column({ type: "varchar", length: 8 })
	interval!: PlanInterval;

	@Column({ type: "jsonb", default: () => "'[]'" })
	prices!: Price[];

	@Column({ type: "jsonb", default: () => "'[]'" })
	scopes!: ContentScope[];

	@Column({ name: "trial_days", type: "int", default: 0 })
	trialDays!: number;

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
