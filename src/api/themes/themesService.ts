import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { IndexerClient, type IndexerThemeTask } from "../indexer/indexerClient.js";

export const THEMES_ENABLED_KEY = "themes_enabled";
const BATCH_SIZE = 200;
const TMDB_KEY = /^tmdb:(\d+)$/;

/** The ThemerrDB entry an item maps to, or null when it is not a TMDB-identified movie or show. */
export function themeTaskFor(
	item: Pick<MediaItem, "libraryId" | "path" | "rootId" | "relativePath" | "type" | "externalKey">,
): IndexerThemeTask | null {
	const match = TMDB_KEY.exec(item.externalKey);
	if (
		!match ||
		(item.type !== "movie" && item.type !== "series") ||
		!item.path ||
		!item.rootId ||
		!item.relativePath
	) {
		return null;
	}
	return {
		libraryId: item.libraryId,
		path: item.path,
		rootId: item.rootId,
		relativePath: item.relativePath,
		itemType: item.type,
		tmdbId: match[1],
	};
}

/** Theme songs from ThemerrDB. The indexer downloads and stores them; flixer only asks for them. */
@Injectable()
export class ThemesService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly indexer: IndexerClient,
	) {}

	async enabled(): Promise<boolean> {
		const row = await this.dataSource.getRepository(Setting).findOneBy({ key: THEMES_ENABLED_KEY });
		return row?.value === true;
	}

	/** The theme song of a movie or show as MP3 bytes. */
	async audio(itemId: string): Promise<Buffer> {
		if (!(await this.enabled())) {
			throw new NotFound("Theme songs are turned off.");
		}
		const item = await this.dataSource.getRepository(MediaItem).findOneBy({ id: itemId, isPlaceholder: false });
		const task = item ? themeTaskFor(item) : null;
		const data = task ? await this.indexer.fetchTheme(task) : null;
		if (!data) {
			throw new NotFound("This item has no theme song.");
		}
		return data;
	}

	/** Asks the indexer to download themes for every movie and show already in the library. */
	async syncAll(libraryId?: string): Promise<{ eligible: number; queued: number }> {
		if (!(await this.enabled())) {
			throw new NotFound("Theme songs are turned off.");
		}
		if (libraryId !== undefined) {
			if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(libraryId)) {
				throw new BadRequest("libraryId must be a library id.");
			}
			if (!(await this.dataSource.getRepository(MediaLibrary).existsBy({ id: libraryId.toLowerCase() }))) {
				throw new NotFound("Media library not found.");
			}
		}
		const repository = this.dataSource.getRepository(MediaItem);
		let eligible = 0;
		let queued = 0;
		let lastId = "";
		for (;;) {
			const query = repository
				.createQueryBuilder("item")
				.where("item.type IN (:...types)", { types: ["movie", "series"] })
				.andWhere("item.is_placeholder = false")
				.andWhere("item.external_key ~ '^tmdb:[0-9]+$'")
				.andWhere("item.id > :lastId", { lastId: lastId || "00000000-0000-0000-0000-000000000000" });
			if (libraryId) {
				query.andWhere("item.library_id = :libraryId", { libraryId: libraryId.toLowerCase() });
			}
			const rows = await query.orderBy("item.id", "ASC").take(BATCH_SIZE).getMany();
			if (rows.length === 0) {
				break;
			}
			lastId = rows[rows.length - 1].id;
			const items = rows.map(themeTaskFor).filter((task): task is IndexerThemeTask => task !== null);
			eligible += items.length;
			if (items.length > 0) {
				const result = await this.indexer.request<{ queued: number }>("POST", "/internal/themes/queue", {
					body: { items },
				});
				queued += result?.queued ?? 0;
			}
		}
		return { eligible, queued };
	}
}
