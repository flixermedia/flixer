import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaSourceGroup } from "../../entities/mediaSourceGroup.entity.js";

interface SourceRow {
	id: string;
	library_id: string;
	type: string;
	is_placeholder: boolean;
}

interface SourceGroup {
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

	async groupFor(itemId: string): Promise<SourceGroup> {
		// RAW SQL: CTE with scalar subqueries and ARRAY() aggregation
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
			// RAW SQL: row locks on media_items (FOR UPDATE ORDER BY id)
			const rows: SourceRow[] = await manager.query("SELECT id, library_id, type, is_placeholder FROM media_items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[primaryId, sourceId]]);
			const primary = rows.find((row) => row.id === primaryId);
			const source = rows.find((row) => row.id === sourceId);
			if (!primary || !source) throw new NotFound("Media item not found.");
			if (primary.is_placeholder || source.is_placeholder || primary.library_id !== source.library_id || primary.type !== source.type || !["movie", "series"].includes(primary.type)) {
				throw new BadRequest("Only available movies or series of the same type and library can be merged.");
			}
			// RAW SQL: advisory transaction lock; no TypeORM equivalent
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`flixer:media-groups:${primary.library_id}`]);
			const ids = [primaryId, sourceId];
			const memberships = await manager.find(MediaSourceGroup, { select: { primaryId: true, sourceId: true }, where: [{ primaryId: In(ids) }, { sourceId: In(ids) }] });
			if (memberships.some((row) => row.sourceId === primaryId || row.primaryId === sourceId || (row.sourceId === sourceId && row.primaryId !== primaryId))) {
				throw new BadRequest("Split the source from its existing group before merging it.");
			}
			if (!memberships.some((row) => row.primaryId === primaryId && row.sourceId === sourceId)) {
				await manager.insert(MediaSourceGroup, { primaryId, sourceId });
			}
		});
	}

	async split(itemId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			// RAW SQL: row lock on media_items (FOR UPDATE)
			const rows: SourceRow[] = await manager.query("SELECT id, library_id, type, is_placeholder FROM media_items WHERE id = $1 FOR UPDATE", [itemId]);
			if (!rows[0]) throw new NotFound("Media item not found.");
			// RAW SQL: advisory transaction lock; no TypeORM equivalent
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`flixer:media-groups:${rows[0].library_id}`]);
			await manager.createQueryBuilder().delete().from(MediaSourceGroup).where("primary_id = :itemId OR source_id = :itemId", { itemId }).execute();
		});
	}
}
