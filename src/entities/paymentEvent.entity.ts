import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** Webhook deliveries already handled, so a redelivered event is ignored. */
@Entity("payment_events")
@Index(["provider", "eventId"], { unique: true })
export class PaymentEvent {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 16 })
	provider!: string;

	@Column({ name: "event_id", type: "varchar", length: 160 })
	eventId!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
