import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/** One title or song a user has marked as a favourite. */
@Entity("favorites")
@Index("idx_favorites_user_created", ["userId", "createdAt"])
export class Favorite {

	@PrimaryColumn({ name: "user_id", type: "uuid" })
	userId!: string;

	@PrimaryColumn({ name: "item_id", type: "uuid" })
	itemId!: string;

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;
}
