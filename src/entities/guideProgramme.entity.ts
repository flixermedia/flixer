import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("guide_programmes")
@Index("IDX_guide_programmes_channel_window", ["sourceId", "channelExternalId", "startMs", "stopMs"])
export class GuideProgramme {
	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "source_id", type: "uuid" })
	sourceId!: string;

	@Column({ name: "channel_external_id", type: "text" })
	channelExternalId!: string;

	@Column({ name: "start_ms", type: "bigint" })
	startMs!: string;

	@Column({ name: "stop_ms", type: "bigint" })
	stopMs!: string;

	@Column({ type: "text" })
	title!: string;

	@Column({ type: "text", nullable: true })
	subtitle!: string | null;

	@Column({ type: "text", nullable: true })
	description!: string | null;

	@Column({ type: "text", nullable: true })
	category!: string | null;
}
