import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type RequestMediaType = "movie" | "tv" | "music";
export type RequestSource = "tmdb" | "discogs";
export type RequestStatus = "pending" | "approved" | "declined" | "failed" | "available";

/** A user's request for a title that is not in the library yet. */
@Entity("media_requests")
@Index("idx_media_requests_user_created", ["userId", "createdAt"])
@Index("idx_media_requests_external", ["type", "externalId"])
@Index("idx_media_requests_status", ["status", "createdAt"])
export class MediaRequest {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ type: "varchar", length: 8 })
	type!: RequestMediaType;

	@Column({ type: "varchar", length: 8 })
	source!: RequestSource;

	/** The TMDB id, or the Discogs master (or release) id. */
	@Column({ name: "external_id", type: "varchar", length: 64 })
	externalId!: string;

	@Column({ type: "varchar", length: 300 })
	title!: string;

	@Column({ type: "integer", nullable: true })
	year!: number | null;

	@Column({ type: "text", nullable: true })
	poster!: string | null;

	@Column({ type: "varchar", length: 300, nullable: true })
	artist!: string | null;

	/** Requested season numbers for a TV request, or null for every season. */
	@Column({ type: "jsonb", nullable: true })
	seasons!: number[] | null;

	@Column({ type: "varchar", length: 16, default: "pending" })
	status!: RequestStatus;

	@Column({ name: "service_id", type: "uuid", nullable: true })
	serviceId!: string | null;

	@Column({ name: "quality_profile_id", type: "integer", nullable: true })
	qualityProfileId!: number | null;

	@Column({ name: "root_folder", type: "text", nullable: true })
	rootFolder!: string | null;

	@Column({ name: "decline_reason", type: "varchar", length: 500, nullable: true })
	declineReason!: string | null;

	@Column({ type: "text", nullable: true })
	error!: string | null;

	@Column({ name: "processed_by", type: "uuid", nullable: true })
	processedBy!: string | null;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt!: Date;
}
