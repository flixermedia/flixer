import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ChatConversation } from "./chatConversation.entity.js";
import { MediaItem } from "./mediaItem.entity.js";
import { User } from "./user.entity.js";

export interface IssueReportAttachment {
	id: string;
	name: string;
	dataUrl: string;
	contentType: string;
}

@Entity("issue_reports")
@Check("ck_issue_reports_status", `"status" IN ('open', 'in_progress', 'resolved', 'closed')`)
@Index("idx_issue_reports_user_updated", ["userId", "updatedAt"])
@Index("idx_issue_reports_status_updated", ["status", "updatedAt"])
export class IssueReport {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "pk_issue_reports" })
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id", foreignKeyConstraintName: "fk_issue_reports_user" })
	user?: User;

	@Column({ name: "media_item_id", type: "uuid", nullable: true })
	mediaItemId!: string | null;

	@ManyToOne(() => MediaItem, { onDelete: "SET NULL" })
	@JoinColumn({ name: "media_item_id", foreignKeyConstraintName: "fk_issue_reports_media" })
	mediaItem?: MediaItem | null;

	@Column({ name: "media_title", type: "varchar", length: 300, nullable: true })
	mediaTitle!: string | null;

	@Column({ type: "varchar", length: 200 })
	title!: string;

	@Column({ type: "varchar", length: 60 })
	category!: string;

	@Column({ type: "text" })
	description!: string;

	@Column({ type: "varchar", length: 16, default: "open" })
	status!: string;

	@Column({ name: "conversation_id", type: "uuid", nullable: true })
	conversationId!: string | null;

	@ManyToOne(() => ChatConversation, { onDelete: "SET NULL" })
	@JoinColumn({ name: "conversation_id", foreignKeyConstraintName: "fk_issue_reports_conversation" })
	conversation?: ChatConversation | null;

	@Column({ name: "chat_open", type: "boolean", default: false })
	chatOpen!: boolean;

	@Column({ type: "jsonb", default: () => "'[]'" })
	attachments!: IssueReportAttachment[];

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
	updatedAt!: Date;

	@Column({ name: "resolved_at", type: "timestamptz", nullable: true })
	resolvedAt!: Date | null;
}

@Entity("issue_report_updates")
@Index("idx_issue_report_updates_report_created", ["reportId", "createdAt"])
export class IssueReportUpdate {

	@PrimaryColumn({ type: "uuid", primaryKeyConstraintName: "pk_issue_report_updates" })
	id!: string;

	@Column({ name: "report_id", type: "uuid" })
	reportId!: string;

	@ManyToOne(() => IssueReport, { onDelete: "CASCADE" })
	@JoinColumn({ name: "report_id", foreignKeyConstraintName: "fk_issue_report_updates_report" })
	report?: IssueReport;

	@Column({ name: "actor_id", type: "uuid", nullable: true })
	actorId!: string | null;

	@ManyToOne(() => User, { onDelete: "SET NULL" })
	@JoinColumn({ name: "actor_id", foreignKeyConstraintName: "fk_issue_report_updates_actor" })
	actor?: User | null;

	@Column({ type: "varchar", length: 2000 })
	body!: string;

	@Column({ name: "is_internal", type: "boolean", default: false })
	isInternal!: boolean;

	@Column({ type: "jsonb", default: () => "'[]'" })
	attachments!: IssueReportAttachment[];

	@Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
	createdAt!: Date;
}
