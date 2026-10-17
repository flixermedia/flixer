import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("user_sessions")
@Index("IDX_user_sessions_user_id", ["userId"])
export class UserSession {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@Column({ name: "expires_at", type: "timestamptz" })
	expiresAt!: Date;
}
