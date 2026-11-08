import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";

interface SourceRow {
	id: string;
	library_id: string;
	type: string;
	is_placeholder: boolean;
}

export interface MediaSourceGroup {
	primaryId: string;
	sourceIds: string[];
}

/**
 * Manages reversible source relationships. Consumers must not hide or combine sources
 * until all browse, playback, access and watch-state paths support these relationships.
 */
@Injectable()
export class MediaSourceGroupService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async groupFor(itemId: string): Promise<MediaSourceGroup> {
		const rows: Array<{ primary_id: string; source_ids: string[] }> = await this.dataSource.query(
			`WITH target AS (
				SELECT COALESCE((SELECT primary_id FROM media_source_groups WHERE source_id = item.id), item.id) AS primary_id
				FROM media_items item WHERE item.id = $1
			)
			SELECT target.primary_id,
				ARRAY(SELECT source_id FROM media_source_groups WHERE primary_id = target.primary_id ORDER BY source_id) AS source_ids
			FROM target`,
			[itemId],
		);
		if (!rows[0]) throw new NotFound("Media item not found.");
		return { primaryId: rows[0].primary_id, sourceIds: rows[0].source_ids };
	}

	async merge(primaryId: string, sourceId: string): Promise<void> {
		if (primaryId === sourceId) throw new BadRequest("A source cannot be merged with itself.");
		await this.dataSource.transaction(async (manager) => {
			const rows: SourceRow[] = await manager.query(
				"SELECT id, library_id, type, is_placeholder FROM media_items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
				[[primaryId, sourceId]],
			);
			const primary = rows.find((row) => row.id === primaryId);
			const source = rows.find((row) => row.id === sourceId);
			if (!primary || !source) throw new NotFound("Media item not found.");
			if (primary.is_placeholder || source.is_placeholder || primary.library_id !== source.library_id ||
				primary.type !== source.type || !["movie", "series"].includes(primary.type)) {
				throw new BadRequest("Only available movies or series of the same type and library can be merged.");
			}
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`flixer:media-groups:${primary.library_id}`]);
			const memberships: Array<{ primary_id: string; source_id: string }> = await manager.query(
				"SELECT primary_id, source_id FROM media_source_groups WHERE primary_id = ANY($1::uuid[]) OR source_id = ANY($1::uuid[])",
				[[primaryId, sourceId]],
			);
			if (memberships.some((row) => row.source_id === primaryId || row.primary_id === sourceId ||
				(row.source_id === sourceId && row.primary_id !== primaryId))) {
				throw new BadRequest("Split the source from its existing group before merging it.");
			}
			if (!memberships.some((row) => row.primary_id === primaryId && row.source_id === sourceId)) {
				await manager.query("INSERT INTO media_source_groups (primary_id, source_id) VALUES ($1, $2)", [primaryId, sourceId]);
			}
		});
	}

	async split(itemId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const rows: SourceRow[] = await manager.query(
				"SELECT id, library_id, type, is_placeholder FROM media_items WHERE id = $1 FOR UPDATE",
				[itemId],
			);
			if (!rows[0]) throw new NotFound("Media item not found.");
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`flixer:media-groups:${rows[0].library_id}`]);
			await manager.query("DELETE FROM media_source_groups WHERE primary_id = $1 OR source_id = $1", [itemId]);
		});
	}
}
