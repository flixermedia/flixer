import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** The single row of payment settings. Secrets are stored encrypted and never leave the server. */
@Entity("payment_config")
export class PaymentConfigRow {

	@PrimaryColumn({ type: "int", default: 1 })
	id!: number;

	@Column({ type: "jsonb", default: () => "'{}'" })
	config!: Record<string, unknown>;

	@Column({ type: "text", nullable: true })
	secrets!: string | null;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
