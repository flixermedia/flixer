import { Column, Entity, PrimaryColumn } from "typeorm";

/** Per-user overrides of the global request settings; null means "use the default". */
@Entity("request_user_limits")
export class RequestUserLimit {

	@PrimaryColumn({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ name: "can_request", type: "boolean", nullable: true })
	canRequest!: boolean | null;

	@Column({ name: "auto_approve", type: "boolean", nullable: true })
	autoApprove!: boolean | null;

	@Column({ name: "quota_limit", type: "integer", nullable: true })
	quotaLimit!: number | null;

	@Column({ name: "quota_days", type: "integer", nullable: true })
	quotaDays!: number | null;
}
