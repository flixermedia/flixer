import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { User } from "./user.entity.js";

export type LibraryAccessMode = "all" | "selected";

/** One window in which playback is allowed, on the given weekdays (0 = Sunday). Times are HH:MM in the schedule's time zone. */
export interface ScheduleWindow {
	days: number[];
	from: string;
	to: string;
}

export interface AccessSchedule {
	timezone: string;
	windows: ScheduleWindow[];
}

/** What one user may watch and when. A missing row means no restrictions. */
@Entity("user_access_policies")
export class UserAccessPolicy {

	@PrimaryColumn({ name: "user_id", type: "uuid" })
	userId!: string;

	@OneToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user?: User;

	@Column({ name: "library_mode", type: "varchar", length: 16, default: "all" })
	libraryMode!: LibraryAccessMode;

	@Column({ name: "library_ids", type: "jsonb", default: () => "'[]'" })
	libraryIds!: string[];

	/** Highest minimum age the user may see; null means no rating limit. */
	@Column({ name: "max_age", type: "int", nullable: true })
	maxAge!: number | null;

	@Column({ name: "block_unrated", type: "boolean", default: false })
	blockUnrated!: boolean;

	/** When not empty, only media carrying at least one of these genres or tags is available. */
	@Column({ name: "allowed_tags", type: "jsonb", default: () => "'[]'" })
	allowedTags!: string[];

	@Column({ name: "blocked_tags", type: "jsonb", default: () => "'[]'" })
	blockedTags!: string[];

	@Column({ type: "jsonb", nullable: true })
	schedule!: AccessSchedule | null;

	/** scrypt hash ("salt:hash", hex) of the PIN that temporarily lifts every restriction on a device. */
	@Column({ name: "pin_hash", type: "varchar", length: 160, nullable: true })
	pinHash!: string | null;

	@Column({ name: "require_request_approval", type: "boolean", default: false })
	requireRequestApproval!: boolean;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
