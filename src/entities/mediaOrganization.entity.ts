import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { OrganizationPlanMove, OrganizationPlanSummary } from "../api/mediaOrganization/mediaOrganizationService.js";
import type { OrganizationTemplates } from "../api/mediaOrganization/organizationPlanLogic.js";

@Entity("media_organization_settings")
export class MediaOrganizationSettings {
	@PrimaryColumn({ name: "library_id", type: "uuid" })
	libraryId!: string;

	@Column({ type: "jsonb" })
	templates!: OrganizationTemplates;

	@Column({ name: "organization_writes_enabled", type: "boolean", default: false })
	organizationWritesEnabled!: boolean;

	@Column({ name: "nfo_writes_enabled", type: "boolean", default: false })
	nfoWritesEnabled!: boolean;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}

@Entity("media_organization_plans")
@Index("IDX_media_organization_plans_library_created", ["libraryId", "createdAt"])
export class MediaOrganizationPlan {
	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "library_id", type: "uuid" })
	libraryId!: string;

	@Column({ type: "varchar", length: 24, default: "preview" })
	state!: "preview" | "executing" | "completed" | "failed" | "rolling_back" | "rolled_back" | "rollback_failed" | "discarded";

	@Column({ type: "jsonb" })
	templates!: OrganizationTemplates;

	@Column({ type: "jsonb" })
	moves!: OrganizationPlanMove[];

	@Column({ type: "jsonb" })
	summary!: OrganizationPlanSummary;

	@Column({ name: "created_by", type: "uuid", nullable: true })
	createdBy!: string | null;

	@Column({ type: "text", nullable: true })
	error!: string | null;

	@Column({ name: "executed_at", type: "timestamptz", nullable: true })
	executedAt!: Date | null;

	@Column({ name: "rolled_back_at", type: "timestamptz", nullable: true })
	rolledBackAt!: Date | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}

@Entity("media_organization_plan_audit")
@Index("IDX_media_organization_plan_audit_plan_created", ["planId", "createdAt"])
export class MediaOrganizationPlanAudit {
	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "plan_id", type: "uuid" })
	planId!: string;

	@Column({ name: "actor_id", type: "uuid", nullable: true })
	actorId!: string | null;

	@Column({ type: "varchar", length: 32 })
	action!: string;

	@Column({ type: "jsonb", default: () => "'{}'" })
	details!: Record<string, unknown>;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
