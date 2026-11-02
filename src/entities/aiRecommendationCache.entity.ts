import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("ai_recommendation_caches")
export class AiRecommendationCache {
	@PrimaryColumn({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ type: "jsonb", default: () => "'{}'::jsonb" })
	entries!: Record<string, unknown>;

	@Column({ name: "last_refresh_at", type: "timestamptz", nullable: true })
	lastRefreshAt!: Date | null;

	@Column({ name: "entry_scopes", type: "jsonb", default: () => "'{}'::jsonb" })
	entryScopes!: Record<string, string>;

	@Column({ name: "refresh_times", type: "jsonb", default: () => "'{}'::jsonb" })
	refreshTimes!: Record<string, string>;
}
