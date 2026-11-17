import { createHash } from "node:crypto";
import { Inject, Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaAccessService, type AccessPolicy } from "../access/mediaAccessService.js";
import { loadSocialItems, toSocialItem } from "./socialItems.js";

const COLLECTION_NAME = "btrim(item.metadata ->> 'collection')";
const COLLECTION_KEY = `lower(${COLLECTION_NAME})`;
const COLLECTION_ID = `encode(sha256(convert_to(${COLLECTION_KEY}, 'UTF8')), 'hex')`;

interface CollectionGroup {
	collectionKey: string;
	name: string;
	itemCount: number;
	coverIds: string[];
}

@Injectable()
export class AutomaticCollectionsService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly access: MediaAccessService,
	) {}

	private visibleMovies(policy: AccessPolicy) {
		const query = this.dataSource.getRepository(MediaItem).createQueryBuilder("item").where("item.is_placeholder = false").andWhere("item.type = 'movie'").andWhere("jsonb_typeof(item.metadata -> 'collection') = 'string'").andWhere(`${COLLECTION_NAME} <> ''`);
		this.access.restrict(query, "item", policy, { content: true });
		return query;
	}

	async list(policy: AccessPolicy) {
		const groups = await this.visibleMovies(policy).select(COLLECTION_KEY, "collectionKey").addSelect(`min(${COLLECTION_NAME})`, "name").addSelect("count(*)::int", "itemCount").addSelect("(array_agg(item.id ORDER BY item.year ASC NULLS LAST, item.sort_title ASC NULLS LAST, item.id ASC))[1:4]", "coverIds").groupBy(COLLECTION_KEY).having("count(*) > 1").orderBy(`min(${COLLECTION_NAME})`, "ASC").getRawMany<CollectionGroup>();
		const cards = await loadSocialItems(
			this.dataSource,
			groups.flatMap((group) => group.coverIds ?? []),
		);
		const byId = new Map(cards.map((card) => [card.id, card]));
		return groups.map((group) => {
			const cover = (group.coverIds ?? []).map((id) => byId.get(id)).find((card) => card?.imageIndex !== null && card?.imageIndex !== undefined);
			return {
				id: createHash("sha256").update(group.collectionKey).digest("hex"),
				name: group.name,
				itemCount: Number(group.itemCount),
				cover: cover ? { itemId: cover.imageItemId, index: cover.imageIndex, version: cover.imageUpdatedAt } : null,
			};
		});
	}

	async get(policy: AccessPolicy, id: string) {
		if (!/^[0-9a-f]{64}$/.test(id)) throw new NotFound("Collection not found.");
		const rows = await this.visibleMovies(policy).select("item.id", "id").addSelect(COLLECTION_NAME, "name").andWhere(`${COLLECTION_ID} = :collectionId`, { collectionId: id }).orderBy("item.year", "ASC", "NULLS LAST").addOrderBy("item.sort_title", "ASC", "NULLS LAST").addOrderBy("item.id", "ASC").getRawMany<{ id: string; name: string }>();
		if (rows.length < 2) throw new NotFound("Collection not found.");
		const items = (
			await loadSocialItems(
				this.dataSource,
				rows.map((row) => row.id),
			)
		).map(toSocialItem);
		if (items.length < 2) throw new NotFound("Collection not found.");
		return { id, name: rows[0].name, itemCount: items.length, items };
	}
}
