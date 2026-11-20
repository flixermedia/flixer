import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaSourceGroup } from "../../entities/mediaSourceGroup.entity.js";

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
		// RAW SQL: scalar subqueries and ARRAY aggregation keep resolution in one database snapshot.
		const primaryId = 'COALESCE((SELECT membership."primary_id" FROM "media_source_groups" membership WHERE membership."source_id" = item.id), item.id)';
		const row = await this.dataSource.getRepository(MediaItem).createQueryBuilder("item").select(primaryId, "primary_id").addSelect(`ARRAY(SELECT membership."source_id" FROM "media_source_groups" membership WHERE membership."primary_id" = ${primaryId} ORDER BY membership."source_id")`, "source_ids").where("item.id = :itemId", { itemId }).getRawOne<{ primary_id: string; source_ids: string[] }>();
		if (!row) throw new NotFound("Media item not found.");
		return { primaryId: row.primary_id, sourceIds: row.source_ids };
	}

	async merge(primaryId: string, sourceId: string): Promise<void> {
		if (primaryId === sourceId) throw new BadRequest("A source cannot be merged with itself.");
		await this.dataSource.transaction(async (manager) => {
			const rows = await manager.createQueryBuilder(MediaItem, "item").select(["item.id", "item.libraryId", "item.type", "item.isPlaceholder"]).whereInIds([primaryId, sourceId]).orderBy("item.id", "ASC").setLock("pessimistic_write").getMany();
			const primary = rows.find((row) => row.id === primaryId);
			const source = rows.find((row) => row.id === sourceId);
			if (!primary || !source) throw new NotFound("Media item not found.");
			if (primary.isPlaceholder || source.isPlaceholder || primary.libraryId !== source.libraryId || primary.type !== source.type || !["movie", "series"].includes(primary.type)) {
				throw new BadRequest("Only available movies or series of the same type and library can be merged.");
			}
			// RAW SQL: PostgreSQL advisory transaction lock function has no ORM equivalent.
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`flixer:media-groups:${primary.libraryId}`]);
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
			const item = await manager.findOne(MediaItem, { select: { id: true, libraryId: true }, where: { id: itemId }, lock: { mode: "pessimistic_write" } });
			if (!item) throw new NotFound("Media item not found.");
			// RAW SQL: PostgreSQL advisory transaction lock function has no ORM equivalent.
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`flixer:media-groups:${item.libraryId}`]);
			await manager.createQueryBuilder().delete().from(MediaSourceGroup).where("primary_id = :itemId OR source_id = :itemId", { itemId }).execute();
		});
	}
}
