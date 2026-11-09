import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

export type QuickConnectStatus = "pending" | "approved" | "denied";

@Entity("quick_connect_requests")
@Index("IDX_quick_connect_requests_expires_at", ["expiresAt"])
export class QuickConnectRequest {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_code_hash", type: "varchar", length: 64, unique: true })
	userCodeHash!: string;

	@Column({ name: "poll_token_hash", type: "varchar", length: 64 })
	pollTokenHash!: string;

	@Column({ type: "varchar", length: 12, default: "pending" })
	status!: QuickConnectStatus;

	@Column({ name: "user_id", type: "uuid", nullable: true })
	userId!: string | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@Column({ name: "expires_at", type: "timestamptz" })
	expiresAt!: Date;
}
