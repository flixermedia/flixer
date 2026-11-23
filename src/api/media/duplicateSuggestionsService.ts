import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import type { DuplicateSuggestion, DuplicateSuggestionItem, DuplicateSuggestionsPage, DuplicateSuggestionsQuery } from "./duplicateSuggestionsDto.js";

const MAX_PAGE_SIZE = 100;
const MAX_ITEMS_PER_SUGGESTION = 10;
const MAX_PAGE = 1_000_000;

interface SuggestionRow {
	library_id: string | null;
	type: string | null;
	kind: "providerId" | "fileHash" | null;
	provider: string | null;
	provider_id: string | null;
	item_count: number | string | null;
	items_truncated: boolean | null;
	items: DuplicateSuggestionItem[] | null;
	total: number | string;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {

	if (!Number.isSafeInteger(value)) return fallback;
	return Math.max(1, Math.min(maximum, value as number));

}

@Injectable()
export class DuplicateSuggestionsService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list(query: DuplicateSuggestionsQuery = {}): Promise<DuplicateSuggestionsPage> {
		const page = boundedInteger(query.page, 1, MAX_PAGE);
		const size = boundedInteger(query.size, 50, MAX_PAGE_SIZE);
		// RAW SQL: CTE with LATERAL jsonb_each_text and UNION ALL
		const rows = await this.dataSource.query<SuggestionRow[]>(
			`
			WITH candidate_rows AS (
				SELECT item.library_id, item.type, 'providerId'::text AS kind, provider.key AS provider, provider.value AS provider_id,
					item.id, item.title, item.year, item.path
				FROM media_items item
				CROSS JOIN LATERAL jsonb_each_text(item.provider_ids) provider
				WHERE item.is_placeholder = false AND btrim(provider.value) <> '' AND lower(provider.key) <> 'tmdbset'
				UNION ALL
				SELECT item.library_id, item.type, 'fileHash'::text AS kind, 'SHA-256'::text AS provider, item.content_hash AS provider_id,
					item.id, item.title, item.year, item.path
				FROM media_items item
				WHERE item.is_placeholder = false AND item.content_hash IS NOT NULL AND btrim(item.content_hash) <> ''
			), ranked_items AS (
				SELECT candidate_rows.*,
					COUNT(*) OVER (PARTITION BY library_id, type, kind, provider, provider_id)::int AS item_count,
					ROW_NUMBER() OVER (PARTITION BY library_id, type, kind, provider, provider_id ORDER BY id) AS item_rank
				FROM candidate_rows
			), duplicate_groups AS (
				SELECT library_id, type, kind, provider, provider_id, MAX(item_count)::int AS item_count,
					COUNT(*) > $3 AS items_truncated,
					jsonb_agg(jsonb_build_object('id', id, 'title', title, 'year', year, 'path', path) ORDER BY id)
						FILTER (WHERE item_rank <= $3) AS items
				FROM ranked_items
				WHERE item_count > 1
				GROUP BY library_id, type, kind, provider, provider_id
			), total_groups AS (
				SELECT COUNT(*)::int AS total FROM duplicate_groups
			), page_groups AS (
				SELECT * FROM duplicate_groups
				ORDER BY library_id, type, kind, provider, provider_id
				OFFSET $1 LIMIT $2
			)
			SELECT page_groups.*, total_groups.total
			FROM total_groups LEFT JOIN page_groups ON true
			ORDER BY page_groups.library_id, page_groups.type, page_groups.kind, page_groups.provider, page_groups.provider_id
		`,
			[(page - 1) * size, size, MAX_ITEMS_PER_SUGGESTION],
		);

		const first = rows[0];
		const items: DuplicateSuggestion[] = rows
			.filter((row) => row.library_id !== null)
			.map((row) => ({
				libraryId: row.library_id!,
				type: row.type!,
				kind: row.kind!,
				provider: row.provider!,
				providerId: row.provider_id!,
				itemCount: Number(row.item_count),
				itemsTruncated: row.items_truncated === true,
				items: row.items ?? [],
			}));

		return { items, total: Number(first?.total ?? 0), page, size };
	}
}
