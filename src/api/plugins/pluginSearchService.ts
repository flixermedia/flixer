import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { PluginWasiRuntime } from "./pluginWasiRuntime.js";

export const SEARCH_CAPABILITY = "search.results";
export const SEARCH_PERMISSION = "api.routes.search";
const SEARCH_TIMEOUT_MS = 7_000;
const MAX_SECTIONS = 4;
const MAX_ITEMS = 40;
const SEARCH_TYPES = new Set(["movie", "series", "album"]);
const TONES = new Set(["neutral", "info", "success", "warning", "danger"]);

export interface PluginSearchItem {
	title: string;
	subtitle?: string;
	poster?: string;
	shape: "poster" | "square";
	badge?: { text: string; tone: string };
	page: string;
	query: Record<string, string>;
}

export interface PluginSearchSection {
	pluginId: string;
	title: string;
	items: PluginSearchItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.slice(0, max) : undefined;
}

function httpsUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length > 2048) return undefined;
	try {
		return new URL(value).protocol === "https:" ? value : undefined;
	} catch {
		return undefined;
	}
}

/** Keeps only the fields and shapes the web app renders, whatever the plugin returned. */
export function sanitizeSearchSections(pluginId: string, result: unknown): PluginSearchSection[] {
	if (!isRecord(result) || !Array.isArray(result.sections)) return [];
	const sections: PluginSearchSection[] = [];
	for (const raw of result.sections.slice(0, MAX_SECTIONS)) {
		if (!isRecord(raw) || !Array.isArray(raw.items)) continue;
		const title = text(raw.title, 80);
		if (!title) continue;
		const items: PluginSearchItem[] = [];
		for (const entry of raw.items.slice(0, MAX_ITEMS)) {
			if (!isRecord(entry)) continue;
			const itemTitle = text(entry.title, 200);
			const page = text(entry.page, 64);
			if (!itemTitle || !page || !/^[a-z][a-z0-9-]{0,63}$/.test(page) || !isRecord(entry.query)) continue;
			const query: Record<string, string> = {};
			for (const [key, value] of Object.entries(entry.query).slice(0, 8)) {
				if (/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(key) && typeof value === "string") query[key] = value.slice(0, 200);
			}
			const badgeText = isRecord(entry.badge) ? text(entry.badge.text, 32) : undefined;
			items.push({
				title: itemTitle,
				subtitle: text(entry.subtitle, 200),
				poster: httpsUrl(entry.poster),
				shape: entry.shape === "square" ? "square" : "poster",
				...(badgeText
					? {
							badge: {
								text: badgeText,
								tone: isRecord(entry.badge) && TONES.has(String(entry.badge.tone)) ? String(entry.badge.tone) : "neutral",
							},
						}
					: {}),
				page,
				query,
			});
		}
		if (items.length > 0) sections.push({ pluginId, title, items });
	}
	return sections;
}

/** Lets enabled plugins add their own result sections to the main search page. */
@Injectable()
export class PluginSearchService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly runtime: PluginWasiRuntime,
	) {}

	async search(user: { id: string; role: string }, q: string, type?: string): Promise<PluginSearchSection[]> {
		const term = q.trim();
		if (term.length < 2 || term.length > 200 || (type !== undefined && !SEARCH_TYPES.has(type))) return [];
		const installations = await this.dataSource.getRepository(PluginInstallation).find({ where: { enabled: true } });
		const providers = installations.filter(
			({ manifest, approvedPermissions }) =>
				manifest.targets.flixer &&
				manifest.capabilities.includes(SEARCH_CAPABILITY) &&
				manifest.permissions.includes(SEARCH_PERMISSION) &&
				approvedPermissions.includes(SEARCH_PERMISSION),
		);
		const results = await Promise.all(
			providers.map(async (installation) => {
				try {
					const result = await withTimeout(
						this.runtime.execute(installation, "search", user, { q: term, ...(type ? { type } : {}) }),
					);
					return sanitizeSearchSections(installation.pluginId, result);
				} catch (error: unknown) {
					logger().warn(`Plugin ${installation.pluginId} search failed.`, error);
					return [];
				}
			}),
		);
		return results.flat();
	}
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("search timed out")), SEARCH_TIMEOUT_MS);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
