import { CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

/** An account that was created but has not yet paid for or saved a card, so it cannot sign in. The row is removed once payment completes. */
@Entity("payment_signups")
export class PaymentSignup {

	@PrimaryColumn({ name: "user_id", type: "uuid" })
	userId!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
