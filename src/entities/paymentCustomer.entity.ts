import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("payment_customers")
@Index(["userId", "provider"], { unique: true })
export class PaymentCustomer {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ type: "varchar", length: 16 })
	provider!: string;

	@Column({ name: "customer_id", type: "varchar", length: 128 })
	customerId!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
