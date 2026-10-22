import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export const NETWORK_SHARE_PROTOCOLS = ["smb"] as const;
export type NetworkShareProtocol = (typeof NETWORK_SHARE_PROTOCOLS)[number];

/**
 * A network share (SMB) the server connects to. Once connected it is offered as a media root, so
 * libraries pick folders from it exactly like they do from a local folder.
 */
@Entity("network_shares")
@Index("UQ_network_shares_name", ["name"], { unique: true })
export class NetworkShare {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	@Column({ type: "varchar", length: 8, default: "smb" })
	protocol!: NetworkShareProtocol;

	@Column({ type: "varchar", length: 255 })
	host!: string;

	@Column({ type: "varchar", length: 255 })
	share!: string;

	@Column({ type: "varchar", length: 255, nullable: true })
	username!: string | null;

	@Column({ type: "varchar", length: 64, nullable: true })
	domain!: string | null;

	/** AES-256-GCM, see shareSecrets.ts. Never returned by the API. */
	@Column({ name: "password_encrypted", type: "text", nullable: true })
	passwordEncrypted!: string | null;

	@Column({ name: "read_only", type: "boolean", default: true })
	readOnly!: boolean;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
