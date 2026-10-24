import { Column, Entity, PrimaryColumn } from "typeorm";

/** The server's VAPID key pair for Web Push; a single row, generated the first time it is needed. */
@Entity("push_keys")
export class PushKey {

	@PrimaryColumn({ type: "integer" })
	id!: number;

	@Column({ name: "public_key", type: "varchar", length: 128 })
	publicKey!: string;

	@Column({ name: "private_key", type: "varchar", length: 128 })
	privateKey!: string;
}
