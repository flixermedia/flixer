import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { ContentScope } from "../api/payments/paymentTypes.js";

/** An uploaded advertisement and the content and break positions it may serve. */
@Entity("advertisements")
export class Advertisement {
	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 200 })
	name!: string;

	@Column({ type: "text", name: "target_url" })
	targetUrl!: string;

	@Column({ type: "varchar", length: 80 })
	filename!: string;

	@Column({ type: "boolean", default: false })
	enabled!: boolean;

	@Column({ type: "jsonb", default: () => "'[]'" })
	scopes!: ContentScope[];

	@Column({ type: "boolean", default: true })
	preroll!: boolean;

	@Column({ name: "midroll_seconds", type: "jsonb", default: () => "'[]'" })
	midrollSeconds!: number[];

	@Column({ name: "skip_after_seconds", type: "int", nullable: true })
	skipAfterSeconds!: number | null;

	@Column({ name: "duration_seconds", type: "double precision" })
	durationSeconds!: number;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
