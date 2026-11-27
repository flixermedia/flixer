import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Invitation } from "./invitation.entity.js";
import { InviteServer } from "./inviteServer.entity.js";

/** Links an invitation to one or more external media servers for multi-service onboarding. */
@Entity("invitation_servers")
@Index("UQ_invitation_servers_pair", ["invitationId", "serverId"], { unique: true })
@Index("IDX_invitation_servers_invitation", ["invitationId"])
export class InvitationServer {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "invitation_id", type: "uuid" })
	invitationId!: string;

	@ManyToOne(() => Invitation, (invitation) => invitation.targets, { onDelete: "CASCADE" })
	@JoinColumn({ name: "invitation_id" })
	invitation?: Invitation;

	@Column({ name: "server_id", type: "uuid" })
	serverId!: string;

	@ManyToOne(() => InviteServer, { onDelete: "CASCADE", eager: true })
	@JoinColumn({ name: "server_id" })
	server?: InviteServer;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
