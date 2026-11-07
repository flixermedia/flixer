import { Column, Entity, PrimaryColumn } from "typeorm";

/** Global scheduling limits; row 1 is installed by migration and is disabled by default. */
@Entity("advertisement_settings")
export class AdvertisementSettings {
	@PrimaryColumn({ type: "int" })
	id!: number;

	@Column({ type: "boolean", default: false })
	enabled!: boolean;

	@Column({ name: "minimum_interval_seconds", type: "int", default: 300 })
	minimumIntervalSeconds!: number;

	@Column({ name: "max_per_playback", type: "int", default: 5 })
	maxPerPlayback!: number;
}
