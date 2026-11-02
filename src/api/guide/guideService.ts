import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { Inject, Injectable, logger } from "@tsed/di";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import ipaddr from "ipaddr.js";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { GuideProgramme } from "../../entities/guideProgramme.entity.js";
import {
	GuideSettings,
	GuideSource,
	type EpgSourceCache,
	type GuideChannelSettings,
	type GuideProgrammeCache,
	type GuideSourceCache,
	type GuideSourceKind,
	type IptvChannelCache,
	type IptvSourceCache,
} from "../../entities/guideSource.entity.js";
import {
	channelNameMatchScore,
	groupRegionalChannels,
	stableChannelId,
	type RegionalGuideChannel,
} from "./guideMatching.js";
import { parseM3u, parseXmltv } from "./guideParsers.js";
import type { CreateGuideSourceRequest, GuideChannelChange, UpdateGuideSourceRequest } from "./guideRequests.js";

const SOURCE_REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_REDIRECTS = 3;
const SOURCE_TIMEOUT_MS = 30_000;
const DEFAULT_FROM_OFFSET_MS = 30 * 60 * 1000;
const MAX_GUIDE_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const AUTO_PAIR_THRESHOLD = 0.6;

export type LiveStreamContainer = "m3u8" | "mpd";

export function liveStreamContainer(value: string): LiveStreamContainer | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		if (/\.m3u8$/i.test(url.pathname)) return "m3u8";
		if (/\.mpd$/i.test(url.pathname)) return "mpd";
		return null;
	} catch {
		return null;
	}
}

interface PublicGuideSource {
	id: string;
	kind: GuideSourceKind;
	name: string;
	url: string;
	enabled: boolean;
	isDefault: boolean;
	sortOrder: number;
	channelCount: number;
	programmeCount: number;
	lastRefreshedAt: Date | null;
	lastError: string | null;
}

interface GuideChannelView {
	id: string;
	name: string;
	icon: string | null;
	alternateNames: string[];
	variantCount: number;
	iptvChannelId: string | null;
	watchable: boolean;
	sortOrder: number;
}

interface GuideProgrammeView extends GuideProgrammeCache {
	channelId: string;
}

interface IptvChannelRecord {
	id: string;
	source: GuideSource;
	channel: IptvChannelCache;
	sortOrder: number;
}

interface GuideCatalog {
	expiresAt: number;
	channels: GuideChannelView[];
	groups: ReturnType<typeof groupRegionalChannels>;
	sources: PublicGuideSource[];
	regionalMergeThresholdPercent: number;
	iptvChannels: IptvChannelRecord[];
}

export function isGlobalAddress(address: string): boolean {
	try {
		return ipaddr.process(address).range() === "unicast";
	} catch {
		return false;
	}
}

export function parseSourceUrl(value: string, allowHttp = false): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new BadRequest("Enter a valid source URL.");
	}
	const allowedPorts = allowHttp ? ["80", "443", "8080", "8443"] : ["443"];
	if (
		(url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) ||
		url.username ||
		url.password ||
		(url.port && !allowedPorts.includes(url.port)) ||
		url.hash ||
		!url.hostname ||
		url.hostname.endsWith(".localhost") ||
		url.hostname.endsWith(".local") ||
		url.hostname.endsWith(".internal")
	) {
		throw new BadRequest("Source URLs must use a public HTTP(S) host without credentials or a custom port.");
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(hostname)) {
		if (!isGlobalAddress(hostname))
			throw new BadRequest("Source URLs cannot point to private or reserved IP addresses.");
	}
	return url;
}

async function validateSourceUrl(value: string, allowHttp = false): Promise<URL> {
	const url = parseSourceUrl(value, allowHttp);
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(hostname)) return url;
	let addresses: LookupAddress[];
	try {
		addresses = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new BadRequest("The source hostname could not be resolved.");
	}
	if (addresses.length === 0 || addresses.some(({ address }) => !isGlobalAddress(address))) {
		throw new BadRequest("Source URLs must resolve only to public IP addresses.");
	}
	return url;
}

async function readRemoteText(url: URL, redirects = 0): Promise<string> {
	await validateSourceUrl(url.toString());
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const address = isIP(hostname) ? hostname : (await lookup(hostname, { all: true, verbatim: true }))[0]?.address;
	if (!address || !isGlobalAddress(address)) {
		throw new Error("The source host did not resolve to a public IP address.");
	}
	return new Promise((resolve, reject) => {
		const request = httpsRequest(
			url,
			{
				method: "GET",
				headers: {
					accept: "application/xml, text/xml, audio/x-mpegurl, application/vnd.apple.mpegurl, */*",
					"user-agent": "Flixer/EPG",
				},
				lookup: (_host, options, callback) => {
					const family = isIP(address);
					if (typeof options === "object" && options.all) callback(null, [{ address, family }]);
					else callback(null, address, family);
				},
				timeout: SOURCE_TIMEOUT_MS,
			},
			(response) => {
				const status = response.statusCode ?? 0;
				if (status >= 300 && status < 400 && response.headers.location) {
					response.resume();
					if (redirects >= MAX_SOURCE_REDIRECTS) {
						reject(new Error("The source redirected too many times."));
						return;
					}
					void validateSourceUrl(new URL(response.headers.location, url).toString())
						.then((redirectUrl) => readRemoteText(redirectUrl, redirects + 1))
						.then(resolve, reject);
					return;
				}
				if (status < 200 || status >= 300) {
					response.resume();
					reject(new Error(`The source returned HTTP ${status}.`));
					return;
				}
				const contentLength = Number(response.headers["content-length"] ?? 0);
				if (contentLength > MAX_SOURCE_BYTES) {
					response.destroy(new Error("The source exceeds the 64 MB download limit."));
					return;
				}
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on("data", (chunk: Buffer | string) => {
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					bytes += buffer.length;
					if (bytes > MAX_SOURCE_BYTES) {
						response.destroy(new Error("The source exceeds the 64 MB download limit."));
						return;
					}
					chunks.push(buffer);
				});
				response.on("error", reject);
				response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			},
		);
		request.on("timeout", () => request.destroy(new Error("The source request timed out.")));
		request.on("error", reject);
		request.end();
	});
}

function cacheHasData(kind: GuideSourceKind, cache: GuideSourceCache): boolean {
	return cache.channels.length > 0 && (kind === "iptv" || (cache as EpgSourceCache).programmes.length > 0);
}

function publicSource(source: GuideSource): PublicGuideSource {
	const channelCount = source.cache.channels.length;
	return {
		id: source.id,
		kind: source.kind,
		name: source.name,
		url: source.url,
		enabled: source.enabled,
		isDefault: source.isDefault,
		sortOrder: source.sortOrder,
		channelCount,
		programmeCount: source.kind === "epg" ? (source.cache as EpgSourceCache).programmes.length : 0,
		lastRefreshedAt: source.lastRefreshedAt,
		lastError: source.lastError,
	};
}

@Injectable()
export class GuideService {
	private readonly refreshes = new Map<string, Promise<GuideSource>>();
	private guideCatalog: GuideCatalog | null = null;

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async getGuide(fromValue?: string, toValue?: string, channelOffsetValue = 0, channelLimitValue = 18) {
		const now = Date.now();
		const from = fromValue ? Date.parse(fromValue) : now - DEFAULT_FROM_OFFSET_MS;
		const to = toValue ? Date.parse(toValue) : now + 7 * 24 * 60 * 60 * 1000;
		if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_GUIDE_WINDOW_MS) {
			throw new BadRequest("The guide window must be valid and no longer than eight days.");
		}
		if (
			!Number.isInteger(channelOffsetValue) ||
			channelOffsetValue < 0 ||
			!Number.isInteger(channelLimitValue) ||
			channelLimitValue < 1 ||
			channelLimitValue > 50
		) {
			throw new BadRequest("Guide channel pagination must use a non-negative offset and a limit from 1 to 50.");
		}

		const catalog = await this.getGuideCatalog();
		const pageGroups = catalog.groups.slice(channelOffsetValue, channelOffsetValue + channelLimitValue);
		return {
			channels: catalog.channels.slice(channelOffsetValue, channelOffsetValue + channelLimitValue),
			programmes: await this.loadProgrammes(pageGroups, from, to),
			totalChannels: catalog.groups.length,
			channelOffset: channelOffsetValue,
			from: new Date(from).toISOString(),
			to: new Date(to).toISOString(),
			regionalMergeThresholdPercent: catalog.regionalMergeThresholdPercent,
			sources: catalog.sources.map(({ id, kind, name, lastRefreshedAt, lastError }) => ({
				id,
				kind,
				name,
				lastRefreshedAt,
				lastError,
			})),
		};
	}

	async adminOverview() {
		const sources = await this.enabledAndDisabledSources();
		await Promise.allSettled(
			sources.filter((source) => source.enabled).map((source) => this.refreshIfStale(source)),
		);
		const current = await this.enabledAndDisabledSources();
		const epgSources = current.filter((source) => source.kind === "epg");
		const iptv = this.iptvChannelRecords(current);
		const channels = this.rawGuideChannels(epgSources, iptv, true)
			.map((channel) => ({
				id: channel.id,
				sourceId: channel.sourceId,
				sourceName: channel.sourceName,
				name: channel.name,
				icon: channel.icon,
				enabled: channel.enabled,
				sortOrder: channel.sortOrder,
				iptvChannelId: channel.iptvChannelId,
				automaticIptvChannelId: this.autoPair([channel], iptv)?.id ?? null,
			}))
			.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
		return {
			sources: current.map(publicSource),
			settings: await this.getSettings(),
			channels,
			iptvChannels: iptv.map(({ id, source, channel, sortOrder }) => ({
				id,
				sourceId: source.id,
				sourceName: source.name,
				name: channel.name,
				icon: channel.icon,
				group: channel.group,
				playable: liveStreamContainer(channel.url) !== null,
				sortOrder,
			})),
		};
	}

	async listSources() {
		return (await this.enabledAndDisabledSources()).map(publicSource);
	}

	async createSource(input: CreateGuideSourceRequest): Promise<PublicGuideSource> {
		const url = await validateSourceUrl(input.url);
		const sources = await this.enabledAndDisabledSources();
		const source = this.dataSource.getRepository(GuideSource).create({
			id: randomUUID(),
			kind: input.kind,
			name: input.name.trim(),
			url: url.toString(),
			enabled: true,
			isDefault: false,
			sortOrder: sources.filter(({ kind }) => kind === input.kind).length,
			cache: input.kind === "epg" ? { channels: [], programmes: [] } : { channels: [] },
			channelSettings: {},
			lastRefreshedAt: null,
			lastError: null,
		});
		const saved = await this.saveSource(source);
		this.invalidateGuideCatalog();
		return publicSource(saved);
	}

	async updateSource(id: string, changes: UpdateGuideSourceRequest): Promise<PublicGuideSource> {
		const source = await this.sourceById(id);
		const update: Partial<GuideSource> = {};
		if (changes.name !== undefined) update.name = changes.name.trim();
		if (changes.url !== undefined) {
			const url = await validateSourceUrl(changes.url);
			if (url.toString() !== source.url) {
				update.url = url.toString();
				update.cache = source.kind === "epg" ? { channels: [], programmes: [] } : { channels: [] };
				update.lastRefreshedAt = null;
				update.lastError = null;
			}
		}
		if (changes.enabled !== undefined) update.enabled = changes.enabled;
		if (changes.sortOrder !== undefined) update.sortOrder = changes.sortOrder;
		if (update.name !== undefined && !update.name) throw new BadRequest("A guide source needs a name.");
		if (Object.keys(update).length > 0) {
			try {
				await this.dataSource.getRepository(GuideSource).update({ id }, update);
			} catch (error) {
				if ((error as { code?: string }).code === "23505")
					throw new Conflict("A source of this type already uses that URL.");
				throw error;
			}
			if (update.url !== undefined) {
				await this.dataSource.getRepository(GuideProgramme).delete({ sourceId: id });
			}
			this.invalidateGuideCatalog();
		}
		return publicSource({ ...source, ...update });
	}

	async removeSource(id: string): Promise<void> {
		const source = await this.sourceById(id);
		if (source.isDefault) throw new BadRequest("Default guide sources cannot be removed; disable them instead.");
		await this.dataSource.getRepository(GuideSource).remove(source);
		this.invalidateGuideCatalog();
	}

	async refreshSourceById(id: string): Promise<PublicGuideSource> {
		return publicSource(await this.refresh(await this.sourceById(id)));
	}

	async updateChannelSettings(changes: GuideChannelChange[]): Promise<void> {
		const sources = await this.enabledAndDisabledSources();
		const epgSources = sources.filter((source) => source.kind === "epg");
		const iptv = this.iptvChannelRecords(sources);
		const updatedSources = new Set<GuideSource>();
		for (const change of changes) {
			const source = epgSources.find((candidate) =>
				(candidate.cache as EpgSourceCache).channels.some(
					(channel) => stableChannelId(candidate.id, channel.externalId) === change.id,
				),
			);
			if (!source) throw new NotFound(`EPG channel ${change.id} was not found.`);
			if (change.iptvChannelId && !iptv.some(({ id }) => id === change.iptvChannelId)) {
				throw new BadRequest(`IPTV channel ${change.iptvChannelId} was not found.`);
			}
			const current = source.channelSettings[change.id] ?? {};
			const updated: GuideChannelSettings = { ...current };
			if (change.enabled !== undefined) updated.enabled = change.enabled;
			if (change.sortOrder !== undefined) updated.sortOrder = change.sortOrder;
			if (Object.hasOwn(change, "iptvChannelId")) updated.iptvChannelId = change.iptvChannelId ?? null;
			source.channelSettings[change.id] = updated;
			updatedSources.add(source);
		}
		if (updatedSources.size > 0) {
			const repository = this.dataSource.getRepository(GuideSource);
			await Promise.all(
				[...updatedSources].map((source) =>
					repository.update({ id: source.id }, { channelSettings: source.channelSettings }),
				),
			);
			this.invalidateGuideCatalog();
		}
	}

	async updateRegionalThreshold(percent: number) {
		if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
			throw new BadRequest("The regional channel match threshold must be a whole number from 1 to 100.");
		}
		const repository = this.dataSource.getRepository(GuideSettings);
		await repository.save(repository.create({ id: 1, regionalMergeThresholdPercent: percent }));
		this.invalidateGuideCatalog();
		return this.getSettings();
	}

	async getPlaybackTarget(
		channelId: string,
	): Promise<{ id: string; name: string; url: string; container: LiveStreamContainer }> {
		const catalog = await this.getGuideCatalog();
		const channel = catalog.channels.find((entry) => entry.id === channelId);
		if (!channel) throw new NotFound("Guide channel not found.");
		if (!channel.iptvChannelId) throw new BadRequest("No IPTV stream is paired with this guide channel.");
		const record = catalog.iptvChannels.find(({ id }) => id === channel.iptvChannelId);
		const container = record ? liveStreamContainer(record.channel.url) : null;
		if (!record || !container) throw new BadRequest("The paired IPTV channel does not have a supported live stream.");
		parseSourceUrl(record.channel.url, true);
		return { id: channel.id, name: channel.name, url: record.channel.url, container };
	}

	private async getSettings(): Promise<{ regionalMergeThresholdPercent: number }> {
		const repository = this.dataSource.getRepository(GuideSettings);
		let settings = await repository.findOneBy({ id: 1 });
		if (!settings)
			settings = await repository.save(repository.create({ id: 1, regionalMergeThresholdPercent: 65 }));
		return { regionalMergeThresholdPercent: settings.regionalMergeThresholdPercent };
	}

	private async getGuideCatalog(): Promise<GuideCatalog> {
		if (this.guideCatalog && this.guideCatalog.expiresAt > Date.now()) return this.guideCatalog;

		const sources = await this.enabledSources();
		await Promise.allSettled(sources.map((source) => this.refreshIfStale(source)));
		const refreshedSources = await this.enabledSources();
		const epgSources = refreshedSources.filter((source) => source.kind === "epg");
		if (!epgSources.some((source) => (source.cache as EpgSourceCache).programmes.length > 0)) {
			throw new Error("No EPG source currently has programme data.");
		}
		const iptvChannels = this.iptvChannelRecords(refreshedSources);
		const settings = await this.getSettings();
		const allGroups = groupRegionalChannels(
			this.rawGuideChannels(epgSources, iptvChannels),
			settings.regionalMergeThresholdPercent,
		);
		const allChannels = allGroups
			.map(({ primary, variants }) => {
				const members = [primary, ...variants];
				const selectedIptv =
					members
						.map((member) =>
							member.iptvChannelId
								? iptvChannels.find(({ id }) => id === member.iptvChannelId)
								: undefined,
						)
						.find((entry): entry is IptvChannelRecord => entry !== undefined) ??
					this.autoPair(members, iptvChannels);
				return {
					id: primary.id,
					name: primary.name,
					icon: primary.icon,
					alternateNames: variants.map(({ name }) => name),
					variantCount: members.length,
					iptvChannelId: selectedIptv?.id ?? null,
					watchable: Boolean(selectedIptv && liveStreamContainer(selectedIptv.channel.url)),
					sortOrder: primary.sortOrder,
				};
			})
			.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
		const linkedChannelIds = new Set(allChannels.filter(({ iptvChannelId }) => iptvChannelId).map(({ id }) => id));
		const groups = allGroups.filter(({ primary }) => linkedChannelIds.has(primary.id));
		const channels = allChannels.filter(({ id }) => linkedChannelIds.has(id));
		this.guideCatalog = {
			expiresAt: Date.now() + SOURCE_REFRESH_MS,
			channels,
			groups,
			sources: refreshedSources.map(publicSource),
			regionalMergeThresholdPercent: settings.regionalMergeThresholdPercent,
			iptvChannels,
		};
		return this.guideCatalog;
	}

	private invalidateGuideCatalog(): void {
		this.guideCatalog = null;
	}

	private async enabledSources(): Promise<GuideSource[]> {
		return this.dataSource.getRepository(GuideSource).find({
			where: { enabled: true },
			order: { sortOrder: "ASC", createdAt: "ASC" },
		});
	}

	private async enabledAndDisabledSources(): Promise<GuideSource[]> {
		return this.dataSource
			.getRepository(GuideSource)
			.find({ order: { kind: "ASC", sortOrder: "ASC", createdAt: "ASC" } });
	}

	private async sourceById(id: string): Promise<GuideSource> {
		const source = await this.dataSource.getRepository(GuideSource).findOneBy({ id });
		if (!source) throw new NotFound("Guide source not found.");
		return source;
	}

	private async saveSource(source: GuideSource): Promise<GuideSource> {
		if (!source.name.trim()) throw new BadRequest("A guide source needs a name.");
		try {
			return await this.dataSource.getRepository(GuideSource).save(source);
		} catch (error) {
			if ((error as { code?: string }).code === "23505")
				throw new Conflict("A source of this type already uses that URL.");
			throw error;
		}
	}

	private refreshIfStale(source: GuideSource): Promise<GuideSource> {
		const cache = source.cache;
		if (
			source.lastRefreshedAt &&
			Date.now() - source.lastRefreshedAt.getTime() < SOURCE_REFRESH_MS &&
			cacheHasData(source.kind, cache)
		) {
			return Promise.resolve(source);
		}
		return this.refresh(source);
	}

	private refresh(source: GuideSource): Promise<GuideSource> {
		const ongoing = this.refreshes.get(source.id);
		if (ongoing) return ongoing;
		const operation = this.fetchAndSave(source)
			.catch(async (error: unknown) => {
				const message = error instanceof Error ? error.message.slice(0, 500) : "The source refresh failed.";
				await this.dataSource.getRepository(GuideSource).update({ id: source.id }, { lastError: message });
				const current = await this.sourceById(source.id);
				if (cacheHasData(current.kind, current.cache)) {
					logger().warn(
						`Guide source "${current.name}" refresh failed; retaining its previous cache.`,
						error,
					);
					return current;
				}
				throw error;
			})
			.finally(() => this.refreshes.delete(source.id));
		this.refreshes.set(source.id, operation);
		return operation;
	}

	private async fetchAndSave(source: GuideSource): Promise<GuideSource> {
		const url = await validateSourceUrl(source.url);
		const text = await readRemoteText(url);
		let cache: GuideSourceCache;
		if (source.kind === "epg") {
			cache = parseXmltv(text);
		} else {
			cache = { channels: parseM3u(text) };
		}
		const latest = await this.sourceById(source.id);
		latest.cache = cache;
		latest.lastRefreshedAt = new Date();
		latest.lastError = null;
		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(GuideSource);
			const saved = await repository.save(latest);
			if (source.kind === "epg") {
				const programmes = (cache as EpgSourceCache).programmes;
				const programmeRepository = manager.getRepository(GuideProgramme);
				await programmeRepository.delete({ sourceId: source.id });
				for (let index = 0; index < programmes.length; index += 1000) {
					await programmeRepository.insert(
						programmes.slice(index, index + 1000).map((programme) => ({
							id: randomUUID(),
							sourceId: source.id,
							channelExternalId: programme.channelExternalId,
							startMs: String(programme.start),
							stopMs: String(programme.stop),
							title: programme.title,
							subtitle: programme.subtitle,
							description: programme.description,
							category: programme.category,
						})),
					);
				}
			}
			this.invalidateGuideCatalog();
			return saved;
		});
	}

	private async loadProgrammes(
		groups: ReturnType<typeof groupRegionalChannels>,
		from: number,
		to: number,
	): Promise<GuideProgrammeView[]> {
		if (groups.length === 0) return [];
		const parameters: Record<string, string | number> = { from, to };
		const channelConditions = groups.map(({ primary }, index) => {
			if (!primary.sourceId || !primary.externalId) {
				throw new Error(`Guide channel "${primary.name}" is missing its source identity.`);
			}
			parameters[`sourceId${index}`] = primary.sourceId;
			parameters[`externalId${index}`] = primary.externalId;
			return `(programme.sourceId = :sourceId${index} AND programme.channelExternalId = :externalId${index})`;
		});
		const entries = await this.dataSource
			.getRepository(GuideProgramme)
			.createQueryBuilder("programme")
			.where(channelConditions.join(" OR "), parameters)
			.andWhere("programme.startMs < :to", { to: String(to) })
			.andWhere("programme.stopMs > :from", { from: String(from) })
			.orderBy("programme.startMs", "ASC")
			.getMany();
		return entries.map((programme) => ({
			channelExternalId: programme.channelExternalId,
			channelId: stableChannelId(programme.sourceId, programme.channelExternalId),
			start: Number(programme.startMs),
			stop: Number(programme.stopMs),
			title: programme.title,
			subtitle: programme.subtitle,
			description: programme.description,
			category: programme.category,
		}));
	}

	private rawGuideChannels(sources: GuideSource[], iptvChannels: IptvChannelRecord[], includeDisabled = false) {
		const result: (RegionalGuideChannel & {
			sourceId: string;
			sourceName: string;
			enabled: boolean;
			externalId: string;
		})[] = [];
		for (const source of sources) {
			if (source.kind !== "epg") continue;
			const cache = source.cache as EpgSourceCache;
			const programmeMap = new Map<string, GuideProgrammeCache[]>();
			for (const programme of cache.programmes) {
				const list = programmeMap.get(programme.channelExternalId) ?? [];
				list.push(programme);
				programmeMap.set(programme.channelExternalId, list);
			}
			cache.channels.forEach((channel, index) => {
				const id = stableChannelId(source.id, channel.externalId);
				const config = source.channelSettings[id];
				const explicitIptvId = config?.iptvChannelId ?? null;
				result.push({
					id,
					sourceId: source.id,
					sourceName: source.name,
					externalId: channel.externalId,
					name: channel.name,
					icon: channel.icon,
					enabled: config?.enabled !== false,
					sortOrder: config?.sortOrder ?? source.sortOrder * 100_000 + index,
					iptvChannelId:
						explicitIptvId && iptvChannels.some(({ id: iptvId }) => iptvId === explicitIptvId)
							? explicitIptvId
							: null,
					programmes: programmeMap.get(channel.externalId) ?? [],
				});
			});
		}
		return includeDisabled ? result : result.filter((channel) => channel.enabled);
	}

	private iptvChannelRecords(sources: GuideSource[]): IptvChannelRecord[] {
		return sources
			.filter((source) => source.kind === "iptv")
			.flatMap((source) => {
				const cache = source.cache as IptvSourceCache;
				return cache.channels.map((channel, index) => ({
					id: stableChannelId(source.id, channel.externalId),
					source,
					channel,
					sortOrder: source.sortOrder * 100_000 + index,
				}));
			});
	}

	private autoPair(members: RegionalGuideChannel[], iptv: IptvChannelRecord[]): IptvChannelRecord | undefined {
		let selected: IptvChannelRecord | undefined;
		let bestScore = 0;
		for (const member of members) {
			for (const candidate of iptv) {
				if (!candidate.source.enabled || !liveStreamContainer(candidate.channel.url)) continue;
				const score = channelNameMatchScore(
					member.name,
					candidate.channel.name,
					candidate.channel.tvgId,
					member.externalId ?? "",
				);
				if (
					score > bestScore ||
					(score === bestScore && selected && candidate.sortOrder < selected.sortOrder)
				) {
					bestScore = score;
					selected = candidate;
				}
			}
		}
		return bestScore >= AUTO_PAIR_THRESHOLD ? selected : undefined;
	}

}
