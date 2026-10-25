import { Inject, Injectable } from "@tsed/di";
import { hostname, platform, release } from "node:os";
import { statfs } from "node:fs/promises";
import { DataSource } from "typeorm";
import { version } from "../../config/config.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { User } from "../../entities/user.entity.js";
import { AdminIndexerService } from "../indexer/adminIndexerService.js";
import { MediaRootsService } from "../mediaLibraries/mediaRootsService.js";
import { StreamsService } from "../streams/streamsService.js";
import { ACTIVITY_FROM, ACTIVITY_SELECT, mapActivityRow, type ActivityRow } from "./activityService.js";

const FILE_TYPES = ["movie", "episode", "track", "video"];
const ACTIVITY_LIMIT = 10;

interface CountRow {
	type: string;
	count: string;
}

interface LibraryRow {
	library_id: string;
	items: string;
	size: string | null;
}

/** Aggregates what the admin dashboard overview shows. */
@Injectable()
export class OverviewService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly roots: MediaRootsService,
		private readonly streams: StreamsService,
		private readonly indexer: AdminIndexerService,
	) {}

	async get() {
		const [counts, libraries, activity, disks, streamer, indexer, users] = await Promise.all([
			this.counts(),
			this.libraries(),
			this.activity(),
			this.disks(),
			this.streamerStatus(),
			this.indexer.status(),
			this.dataSource.getRepository(User).count(),
		]);

		return {
			counts: { ...counts, users },
			libraries,
			storage: {
				usedBytes: libraries.reduce((sum, library) => sum + library.sizeBytes, 0),
				disks,
			},
			activity,
			server: {
				name: hostname(),
				version,
				node: process.version,
				os: `${platform()} ${release()}`,
				uptimeSeconds: Math.round(process.uptime()),
				streamer,
				indexer: { reachable: indexer.reachable, activeScans: indexer.scans.length, providers: indexer.enabledProviders },
			},
		};
	}

	private async counts() {
		const rows: CountRow[] = await this.dataSource.query(`SELECT type, COUNT(*)::text AS count FROM media_items WHERE is_placeholder = false GROUP BY type`);
		const byType = new Map(rows.map((row) => [row.type, Number(row.count)]));
		return {
			movies: byType.get("movie") ?? 0,
			series: byType.get("series") ?? 0,
			episodes: byType.get("episode") ?? 0,
			albums: byType.get("album") ?? 0,
			tracks: byType.get("track") ?? 0,
		};
	}

	private async libraries() {
		const [entities, rows] = await Promise.all([
			this.dataSource.getRepository(MediaLibrary).find({ order: { name: "ASC" } }),
			this.dataSource.query(
				`SELECT library_id, COUNT(*)::text AS items, SUM(size_bytes)::text AS size FROM media_items WHERE is_placeholder = false AND type = ANY($1) GROUP BY library_id`,
				[FILE_TYPES],
			) as Promise<LibraryRow[]>,
		]);
		const byLibrary = new Map(rows.map((row) => [row.library_id, row]));
		return entities.map((library) => {
			const row = byLibrary.get(library.id);
			return { id: library.id, name: library.name, type: library.type, items: Number(row?.items ?? 0), sizeBytes: Number(row?.size ?? 0) };
		});
	}

	private async activity() {
		const rows: ActivityRow[] = await this.dataSource.query(`SELECT ${ACTIVITY_SELECT} ${ACTIVITY_FROM} ORDER BY w.updated_at DESC LIMIT $1`, [ACTIVITY_LIMIT]);
		return rows.map(mapActivityRow);
	}

	/** Free and total space of the file systems holding the media roots; roots on one disk are merged. */
	private async disks() {
		const seen = new Map<string, { totalBytes: number; freeBytes: number; roots: string[] }>();
		for (const root of this.roots.list()) {
			try {
				const stats = await statfs(root.path);
				const totalBytes = Number(stats.blocks) * Number(stats.bsize);
				const freeBytes = Number(stats.bavail) * Number(stats.bsize);
				const key = `${totalBytes}:${freeBytes}`;
				const existing = seen.get(key);
				if (existing) {
					existing.roots.push(root.name);
				} else {
					seen.set(key, { totalBytes, freeBytes, roots: [root.name] });
				}
			} catch {
				// A root that is offline or unmounted just has no disk figures.
			}
		}
		return [...seen.values()];
	}

	private async streamerStatus() {
		try {
			const data = await this.streams.fetchSessions();
			return { reachable: true, transcodingAvailable: data.transcodingAvailable, activeTranscodes: data.activeTranscodes, maxTranscodes: data.maxTranscodes, sessions: data.sessions.length };
		} catch {
			return { reachable: false, transcodingAvailable: false, activeTranscodes: 0, maxTranscodes: 0, sessions: 0 };
		}
	}
}
