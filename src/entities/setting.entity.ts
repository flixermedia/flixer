import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("settings")
export class Setting {

	@PrimaryGeneratedColumn()
	id!: number;

	@Column({ type: "varchar", length: 128 })
	key!: string;

	@Column({ type: "jsonb", nullable: true })
	value!: unknown | null;

	@Column({ name: "is_public", type: "boolean", default: false })
	isPublic!: boolean;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
