import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Favorite } from "../../entities/favorite.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { FAVORITE_TYPES, loadSocialItems, toSocialItem, type SocialItem } from "./socialItems.js";

const LIST_LIMIT = 500;

@Injectable()
export class FavoritesService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	/** The user's favourites, newest first. */
	async list(userId: string, limit = LIST_LIMIT): Promise<SocialItem[]> {
		const rows = await this.dataSource.getRepository(Favorite).find({ where: { userId }, order: { createdAt: "DESC" }, take: limit });
		const cards = await loadSocialItems(this.dataSource, rows.map((row) => row.itemId), new Map(rows.map((row) => [row.itemId, row.createdAt])));
		return cards.map(toSocialItem);
	}

	async ids(userId: string): Promise<string[]> {
		const rows = await this.dataSource.getRepository(Favorite).find({ where: { userId }, select: { itemId: true } });
		return rows.map((row) => row.itemId);
	}

	async add(userId: string, itemId: string): Promise<void> {
		const item = await this.dataSource.getRepository(MediaItem).findOne({ where: { id: itemId, isPlaceholder: false }, select: { id: true, type: true } });
		if (!item) {
			throw new NotFound("Media item not found.");
		}
		if (!FAVORITE_TYPES.includes(item.type)) {
			throw new BadRequest("This kind of item cannot be favourited.");
		}
		await this.dataSource.getRepository(Favorite).createQueryBuilder().insert().values({ userId, itemId }).orIgnore().execute();
	}

	async remove(userId: string, itemId: string): Promise<void> {
		await this.dataSource.getRepository(Favorite).delete({ userId, itemId });
	}
}
