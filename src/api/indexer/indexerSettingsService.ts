import { BadRequest } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { SECRET_MASK } from "../settings/secretMask.js";

export const INDEXER_LANGUAGE_KEY = "indexer_language";
export const INDEXER_PROVIDERS_KEY = "indexer_providers";
export const INDEXER_CONCURRENCY_KEY = "indexer_concurrency";
export const INDEXER_SUBTITLES_KEY = "indexer_subtitles";
export const INDEXER_SETTING_KEYS = [INDEXER_LANGUAGE_KEY, INDEXER_PROVIDERS_KEY, INDEXER_CONCURRENCY_KEY, INDEXER_SUBTITLES_KEY];

/** Providers that need an API key (or client name) and the ones that work without one. */
export const KEYED_PROVIDERS = ["tmdb", "tvdb", "omdb", "fanart", "audiodb", "discogs", "anidb"];
export const KEYLESS_PROVIDERS = ["musicbrainz", "anilist"];
export const INDEXER_PROVIDERS = [...KEYED_PROVIDERS, ...KEYLESS_PROVIDERS];

/** Worker queues of the indexer pipeline and the highest concurrency it accepts. */
export const INDEXER_QUEUES = ["scan", "identify", "metadata", "images", "probe", "refresh"];
export const INDEXER_MAX_CONCURRENCY = 64;

export interface IndexerProviderSetting {
	enabled: boolean;
	apiKey?: string;
}

export interface IndexerSubtitleSetting {
	apiKey: string;
	username: string;
	password: string;
	languages: string[];
	autoFetch: boolean;
}

export interface IndexerSettings {
	providers: Record<string, IndexerProviderSetting>;
	concurrency: Record<string, number>;
	language: string;
	subtitles: IndexerSubtitleSetting;
}

const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The indexer's dynamic configuration: metadata providers, worker concurrency and the metadata language. */
@Injectable()
export class IndexerSettingsService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	/** Validates a new value for an indexer setting; masked secrets keep the stored value. */
	validate(key: string, value: unknown, current: unknown): unknown {
		switch (key) {
			case INDEXER_LANGUAGE_KEY:
				if (typeof value !== "string" || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(value)) {
					throw new BadRequest("The indexer_language setting must be a language code such as en or pt-BR.");
				}
				return value;
			case INDEXER_PROVIDERS_KEY:
				return this.validateProviders(value, isRecord(current) ? current : {});
			case INDEXER_CONCURRENCY_KEY:
				return this.validateConcurrency(value);
			case INDEXER_SUBTITLES_KEY:
				return this.validateSubtitles(value, isRecord(current) ? current : {});
			default:
				return value;
		}
	}

	/** Hides provider API keys and the OpenSubtitles credentials. */
	mask(key: string, value: unknown): unknown {
		if (key === INDEXER_SUBTITLES_KEY && isRecord(value)) {
			return { ...value, apiKey: value.apiKey ? SECRET_MASK : "", password: value.password ? SECRET_MASK : "" };
		}
		if (key !== INDEXER_PROVIDERS_KEY || !isRecord(value)) {
			return value;
		}
		const masked: Record<string, unknown> = {};
		for (const [name, provider] of Object.entries(value)) {
			masked[name] = isRecord(provider) ? { ...provider, apiKey: provider.apiKey ? SECRET_MASK : "" } : provider;
		}
		return masked;
	}

	/** What flixer-indexer fetches from /api/indexer/settings. */
	async forIndexer(): Promise<IndexerSettings> {
		const rows = await this.dataSource.getRepository(Setting).find();
		const value = (key: string) => rows.find((row) => row.key === key)?.value;

		const providers: Record<string, IndexerProviderSetting> = {};
		const stored = value(INDEXER_PROVIDERS_KEY);
		for (const [name, provider] of Object.entries(isRecord(stored) ? stored : {})) {
			if (isRecord(provider)) {
				providers[name] = { enabled: provider.enabled !== false, apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "" };
			}
		}

		const concurrency: Record<string, number> = {};
		const storedConcurrency = value(INDEXER_CONCURRENCY_KEY);
		for (const [queue, count] of Object.entries(isRecord(storedConcurrency) ? storedConcurrency : {})) {
			if (typeof count === "number") {
				concurrency[queue] = count;
			}
		}

		const language = value(INDEXER_LANGUAGE_KEY);
		const storedSubtitles = value(INDEXER_SUBTITLES_KEY);
		const subs = isRecord(storedSubtitles) ? storedSubtitles : {};
		const subtitles: IndexerSubtitleSetting = {
			apiKey: typeof subs.apiKey === "string" ? subs.apiKey : "",
			username: typeof subs.username === "string" ? subs.username : "",
			password: typeof subs.password === "string" ? subs.password : "",
			languages: Array.isArray(subs.languages) ? subs.languages.filter((item): item is string => typeof item === "string") : [],
			autoFetch: subs.autoFetch !== false,
		};
		return { providers, concurrency, language: typeof language === "string" ? language : "en", subtitles };
	}

	private validateSubtitles(value: unknown, current: Record<string, unknown>): IndexerSubtitleSetting {
		if (!isRecord(value)) {
			throw new BadRequest("The indexer_subtitles setting must be an object.");
		}
		const text = (field: string, max: number, secret: boolean): string => {
			const raw = value[field];
			if (raw === undefined || raw === null) {
				return "";
			}
			if (typeof raw !== "string" || raw.length > max) {
				throw new BadRequest(`The OpenSubtitles ${field} must be text up to ${max} characters.`);
			}
			if (secret && raw === SECRET_MASK) {
				return typeof current[field] === "string" ? (current[field] as string) : "";
			}
			return secret ? raw : raw.trim();
		};
		const languages = value.languages ?? [];
		if (!Array.isArray(languages) || languages.length > 10 || !languages.every((item) => typeof item === "string" && LANGUAGE_PATTERN.test(item))) {
			throw new BadRequest("Subtitle languages must be a list of up to 10 language codes such as en or pt-BR.");
		}
		if (value.autoFetch !== undefined && typeof value.autoFetch !== "boolean") {
			throw new BadRequest("The OpenSubtitles autoFetch flag must be a boolean.");
		}
		return {
			apiKey: text("apiKey", 256, true).trim(),
			username: text("username", 128, false),
			password: text("password", 256, true),
			languages: [...new Set(languages as string[])],
			autoFetch: value.autoFetch !== false,
		};
	}

	private validateProviders(value: unknown, current: Record<string, unknown>): Record<string, IndexerProviderSetting> {
		if (!isRecord(value)) {
			throw new BadRequest("The indexer_providers setting must be an object keyed by provider name.");
		}
		const result: Record<string, IndexerProviderSetting> = {};
		for (const [name, provider] of Object.entries(value)) {
			if (!INDEXER_PROVIDERS.includes(name)) {
				throw new BadRequest(`Unknown metadata provider "${name}".`);
			}
			if (!isRecord(provider) || typeof provider.enabled !== "boolean") {
				throw new BadRequest(`Provider "${name}" needs an enabled flag.`);
			}
			const entry: IndexerProviderSetting = { enabled: provider.enabled };
			if (provider.apiKey !== undefined) {
				if (typeof provider.apiKey !== "string" || provider.apiKey.length > 512) {
					throw new BadRequest(`The API key for "${name}" must be text up to 512 characters.`);
				}
				const previous = current[name];
				const previousKey = isRecord(previous) && typeof previous.apiKey === "string" ? previous.apiKey : "";
				entry.apiKey = provider.apiKey === SECRET_MASK ? previousKey : provider.apiKey.trim();
			}
			result[name] = entry;
		}
		return result;
	}

	private validateConcurrency(value: unknown): Record<string, number> {
		if (!isRecord(value)) {
			throw new BadRequest("The indexer_concurrency setting must be an object keyed by queue name.");
		}
		const result: Record<string, number> = {};
		for (const [queue, count] of Object.entries(value)) {
			if (!INDEXER_QUEUES.includes(queue)) {
				throw new BadRequest(`Unknown indexer queue "${queue}".`);
			}
			if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > INDEXER_MAX_CONCURRENCY) {
				throw new BadRequest(`Concurrency for "${queue}" must be a whole number between 1 and ${INDEXER_MAX_CONCURRENCY}.`);
			}
			result[queue] = count;
		}
		return result;
	}
}
