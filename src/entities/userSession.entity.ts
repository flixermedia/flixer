import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "./user.entity.js";

@Entity("user_sessions")
@Index("IDX_user_sessions_user_id", ["userId"])
export class UserSession {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user?: User;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@Column({ name: "expires_at", type: "timestamptz" })
	expiresAt!: Date;

	@Column({ name: "user_agent", type: "varchar", length: 512, nullable: true })
	userAgent!: string | null;

	@Column({ name: "ip_address", type: "varchar", length: 64, nullable: true })
	ipAddress!: string | null;

	@Column({ name: "last_seen_at", type: "timestamptz", default: () => "now()" })
	lastSeenAt!: Date;
}
