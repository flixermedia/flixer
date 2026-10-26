import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Conflict, Forbidden, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, In, MoreThan, Not } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaRequest, type RequestMediaType, type RequestStatus } from "../../entities/mediaRequest.entity.js";
import type { RequestServiceKind } from "../../entities/requestService.entity.js";
import { RequestUserLimit } from "../../entities/requestUserLimit.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import type { PublicUser } from "../auth/authService.js";
import { NotificationService } from "../notifications/notificationService.js";
import { ArrError } from "./arrClient.js";
import {
	type DiscoverSection,
	type ExternalMediaCard,
	type ExternalMediaDetail,
	normalizeTitle,
} from "./externalMetadata.js";
import { ExternalMetadataService } from "./externalMetadataService.js";
import { type RequestAccess, remainingSeasons, resolveAccess } from "./requestAccess.js";
import type { ApproveRequestBody, CreateMediaRequest, RequestUserLimitInput } from "./requestRequests.js";
import { type RequestSettings, parseRequestSettings, MAX_QUOTA_DAYS, MAX_QUOTA_LIMIT } from "./requestSettings.js";
import { RequestServicesService, clientFor, targetOf } from "./requestServicesService.js";
import { cachedImageUrl } from "./tmdbImageCache.js";

const KIND_OF: Record<RequestMediaType, RequestServiceKind> = { movie: "radarr", tv: "sonarr", music: "lidarr" };
const ALL_STATUSES: RequestStatus[] = ["pending", "approved", "declined", "failed", "available"];
const MAX_PAGE = 100;
const SYNC_INTERVAL_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface MediaRequestView {
	id: string;
	type: RequestMediaType;
	source: string;
	externalId: string;
	title: string;
	year: number | null;
	poster: string | null;
	seasons: number[] | null;
	status: RequestStatus;
	requestedBy: { id: string; username: string; displayName: string | null };
	serviceName: string | null;
	declineReason: string | null;
	error: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface RequestsConfig {
	enabled: boolean;
	movies: boolean;
	tv: boolean;
	music: boolean;
	canRequest: boolean;
	autoApprove: boolean;
	isAdmin: boolean;
	quota: { limit: number | null; days: number; used: number; remaining: number | null };
	tmdbConfigured: boolean;
	discogsConfigured: boolean;
}

export interface RequestUserLimitView {
	id: string;
	username: string;
	displayName: string | null;
	role: string;
	canRequest: boolean | null;
	autoApprove: boolean | null;
	quotaLimit: number | null;
	quotaDays: number | null;
}

const cardKey = (type: RequestMediaType, id: string) => `${type}:${id}`;

/** Requests for titles that are not in the library yet, from creation through approval to arriving in the library. */
@Injectable()
export class MediaRequestsService {

	private syncTimer: ReturnType<typeof setInterval> | undefined;
	private syncing = false;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly metadata: ExternalMetadataService,
		private readonly services: RequestServicesService,
		private readonly notifications: NotificationService,
	) {}

	$onInit(): void {
		this.syncTimer = setInterval(
			() =>
				void this.syncAvailability().catch((error: unknown) =>
					logger().error("Request availability sync failed.", error),
				),
			SYNC_INTERVAL_MS,
		);
		this.syncTimer.unref();
	}

	$onDestroy(): void {
		clearInterval(this.syncTimer);
	}

	/** The settings, with each media type switched off when no Sonarr, Radarr or Lidarr server is set up to fulfil it. */
	async settings(): Promise<RequestSettings> {
		const rows = await this.dataSource.getRepository(Setting).find();
		const settings = parseRequestSettings(new Map(rows.map((row) => [row.key, row.value])));
		const kinds = await this.services.usableKinds();
		return {
			...settings,
			movies: settings.movies && kinds.has("radarr"),
			tv: settings.tv && kinds.has("sonarr"),
			music: settings.music && kinds.has("lidarr"),
		};
	}

	private async accessOf(user: PublicUser, settings: RequestSettings): Promise<RequestAccess> {
		const limit =
			user.role === "admin"
				? null
				: await this.dataSource.getRepository(RequestUserLimit).findOneBy({ userId: user.id });
		return resolveAccess(user.role === "admin", settings, limit);
	}

	private async quotaUsed(userId: string, days: number): Promise<number> {
		return this.dataSource.getRepository(MediaRequest).count({
			where: { userId, status: Not("declined"), createdAt: MoreThan(new Date(Date.now() - days * DAY_MS)) },
		});
	}

	async config(user: PublicUser): Promise<RequestsConfig> {
		const settings = await this.settings();
		const access = await this.accessOf(user, settings);
		const used = access.quotaLimit === null ? 0 : await this.quotaUsed(user.id, access.quotaDays);
		const configured = await this.metadata.isConfigured();
		return {
			enabled: settings.enabled,
			movies: settings.movies,
			tv: settings.tv,
			music: settings.music,
			canRequest: settings.enabled && access.canRequest,
			autoApprove: access.autoApprove,
			isAdmin: user.role === "admin",
			quota: {
				limit: access.quotaLimit,
				days: access.quotaDays,
				used,
				remaining: access.quotaLimit === null ? null : Math.max(0, access.quotaLimit - used),
			},
			tmdbConfigured: configured.tmdb,
			discogsConfigured: configured.discogs,
		};
	}

	/** Throws unless requests are on and this user may browse and make them. */
	private async requireRequester(user: PublicUser): Promise<{ settings: RequestSettings; access: RequestAccess }> {
		const settings = await this.settings();
		if (!settings.enabled) {
			throw new Forbidden("Requests are turned off.");
		}
		const access = await this.accessOf(user, settings);
		if (!access.canRequest) {
			throw new Forbidden("You are not allowed to make requests.");
		}
		return { settings, access };
	}

	async search(user: PublicUser, query: string, type?: string): Promise<ExternalMediaCard[]> {
		const settings = await this.settings();
		const access = await this.accessOf(user, settings);
		const term = query.trim().slice(0, 100);
		if (!settings.enabled || !access.canRequest || term.length < 2) {
			return [];
		}
		const kind = type === "movie" || type === "tv" || type === "music" ? type : undefined;
		const cards = await this.metadata.search(term, kind, {
			movie: settings.movies,
			tv: settings.tv,
			music: settings.music,
		});
		return this.annotate(cards, true);
	}

	async discover(user: PublicUser, section: DiscoverSection): Promise<ExternalMediaCard[]> {
		const { settings } = await this.requireRequester(user);
		const wanted = (card: ExternalMediaCard) => settings[card.type === "movie" ? "movies" : card.type];
		const cards = (await this.metadata.discover(section)).filter(wanted);
		return this.annotate(cards, true);
	}

	/** Adds each card's request status and, when asked, drops the ones that are already in the library. */
	private async annotate(cards: ExternalMediaCard[], dropLibrary: boolean): Promise<ExternalMediaCard[]> {
		if (cards.length === 0) {
			return cards;
		}
		const inLibrary = await this.libraryMatches(cards);
		const requests = await this.dataSource.getRepository(MediaRequest).find({
			where: cards.map((card) => ({ type: card.type, externalId: card.id })),
			order: { createdAt: "DESC" },
		});
		const latest = new Map<string, MediaRequest>();
		for (const request of requests) {
			const key = cardKey(request.type, request.externalId);
			if (!latest.has(key)) {
				latest.set(key, request);
			}
		}
		return cards
			.filter((card) => !(dropLibrary && inLibrary.has(cardKey(card.type, card.id))))
			.map((card) => {
				const request = latest.get(cardKey(card.type, card.id));
				const available = inLibrary.has(cardKey(card.type, card.id));
				return {
					...card,
					status: available ? "available" : (request?.status ?? "none"),
					requestId: request?.id ?? null,
				};
			});
	}

	/** Maps `type:id` to the library item that already holds a title, matched by provider id or else by title and year. */
	private async libraryMatches(
		cards: Array<Pick<ExternalMediaCard, "type" | "id" | "title" | "year" | "source">>,
	): Promise<Map<string, string>> {
		const matches = new Map<string, string>();
		const repository = this.dataSource.getRepository(MediaItem);
		const libraryType = (type: RequestMediaType) =>
			type === "movie" ? "movie" : type === "tv" ? "series" : "album";

		const keys = cards.map((card) => `${card.source}:${card.id}`);
		const keyed = await repository.find({
			select: { id: true, externalKey: true, type: true },
			where: { externalKey: In(keys), isPlaceholder: false },
		});
		for (const item of keyed) {
			const card = cards.find(
				(entry) => `${entry.source}:${entry.id}` === item.externalKey && libraryType(entry.type) === item.type,
			);
			if (card) {
				matches.set(cardKey(card.type, card.id), item.id);
			}
		}

		const unmatched = cards.filter((card) => !matches.has(cardKey(card.type, card.id)));
		if (unmatched.length === 0) {
			return matches;
		}
		const titles = [...new Set(unmatched.map((card) => card.title.toLowerCase()))];
		const candidates = await repository
			.createQueryBuilder("item")
			.select(["item.id", "item.type", "item.title", "item.year"])
			.where("item.is_placeholder = false")
			.andWhere("item.type IN (:...types)", { types: ["movie", "series", "album"] })
			.andWhere("lower(item.title) IN (:...titles)", { titles })
			.getMany();
		for (const card of unmatched) {
			const wanted = normalizeTitle(card.title);
			const found = candidates.find((item) => {
				if (item.type !== libraryType(card.type) || normalizeTitle(item.title) !== wanted) {
					return false;
				}
				return (
					card.type === "music" ||
					card.year === null ||
					item.year === null ||
					Math.abs(item.year - card.year) <= 1
				);
			});
			if (found) {
				matches.set(cardKey(card.type, card.id), found.id);
			}
		}
		return matches;
	}

	async details(
		user: PublicUser,
		type: RequestMediaType,
		id: string,
	): Promise<ExternalMediaDetail & { requests: MediaRequestView[]; libraryItemId: string | null }> {
		const { settings } = await this.requireRequester(user);
		if (!settings[type === "movie" ? "movies" : type]) {
			throw new NotFound("This kind of request is not available.");
		}
		const detail = await this.metadata.details(type, id);
		const [annotated] = await this.annotate([detail], false);
		const libraryItemId = (await this.libraryMatches([detail])).get(cardKey(type, id)) ?? null;
		const requests = await this.dataSource
			.getRepository(MediaRequest)
			.find({ where: { type, externalId: id }, order: { createdAt: "DESC" } });
		const views = await this.toViews(requests);
		const seasons = detail.seasons?.map((season) => {
			const covering = requests.find(
				(request) =>
					request.status !== "declined" &&
					(request.seasons === null || request.seasons.includes(season.number)),
			);
			return { ...season, status: covering?.status ?? ("none" as const) };
		});
		return {
			...detail,
			status: annotated.status,
			requestId: annotated.requestId,
			seasons: seasons ?? null,
			libraryItemId,
			requests: views,
		};
	}

	async create(user: PublicUser, body: CreateMediaRequest): Promise<MediaRequestView> {
		const { settings, access } = await this.requireRequester(user);
		if (!settings[body.type === "movie" ? "movies" : body.type]) {
			throw new Forbidden("This kind of request is turned off.");
		}
		if (access.quotaLimit !== null) {
			const used = await this.quotaUsed(user.id, access.quotaDays);
			if (used >= access.quotaLimit) {
				throw new BadRequest(
					`You have used all ${access.quotaLimit} requests allowed every ${access.quotaDays} days.`,
				);
			}
		}

		const detail = await this.metadata.details(body.type, body.externalId);
		const repository = this.dataSource.getRepository(MediaRequest);
		const existing = await repository.find({
			where: {
				type: body.type,
				externalId: body.externalId,
				status: In(["pending", "approved", "available"] as RequestStatus[]),
			},
		});

		let seasons: number[] | null = null;
		if (body.type === "tv") {
			const all = (detail.seasons ?? []).map((season) => season.number);
			const wanted =
				body.seasons && body.seasons.length > 0 ? body.seasons.filter((season) => all.includes(season)) : null;
			if (body.seasons && body.seasons.length > 0 && wanted?.length === 0) {
				throw new BadRequest("Choose at least one valid season.");
			}
			seasons = remainingSeasons(
				wanted,
				existing.map((request) => request.seasons),
				all,
			);
			if (seasons.length === 0) {
				throw new Conflict("Every chosen season has already been requested.");
			}
			if (wanted === null && seasons.length === all.length) {
				seasons = null;
			}
		} else {
			if (existing.length > 0) {
				throw new Conflict("This has already been requested.");
			}
			if ((await this.libraryMatches([detail])).has(cardKey(body.type, body.externalId))) {
				throw new Conflict("This is already in the library.");
			}
		}

		const request = new MediaRequest();
		request.id = randomUUID();
		request.userId = user.id;
		request.type = body.type;
		request.source = detail.source;
		request.externalId = body.externalId;
		request.title = detail.title.slice(0, 300);
		request.year = detail.year;
		request.poster = detail.poster;
		request.artist = detail.artist?.slice(0, 300) ?? null;
		request.seasons = seasons;
		request.status = "pending";
		request.serviceId = null;
		request.qualityProfileId = null;
		request.rootFolder = null;
		request.declineReason = null;
		request.error = null;
		request.processedBy = null;
		if (user.role === "admin") {
			request.serviceId = body.serviceId ?? null;
			request.qualityProfileId = body.qualityProfileId ?? null;
			request.rootFolder = body.rootFolder?.trim() || null;
		}
		await repository.save(request);

		if (access.autoApprove) {
			await this.process(request, user.id);
		} else if (settings.notifyAdmins) {
			await this.notifyAdmins(request, user);
		}
		return (await this.toViews([await repository.findOneByOrFail({ id: request.id })]))[0];
	}

	async list(
		user: PublicUser,
		scope: string,
		status: string | undefined,
		type: string | undefined,
		offset: number,
		limit: number,
	) {
		const settings = await this.settings();
		if (!settings.enabled) {
			return { total: 0, counts: Object.fromEntries(ALL_STATUSES.map((entry) => [entry, 0])), items: [] };
		}
		const all = scope === "all";
		if (all && user.role !== "admin") {
			throw new Forbidden("Only administrators can see every request.");
		}
		const base = this.dataSource.getRepository(MediaRequest).createQueryBuilder("request");
		if (!all) {
			base.where("request.user_id = :userId", { userId: user.id });
		}
		if (type === "movie" || type === "tv" || type === "music") {
			base.andWhere("request.type = :type", { type });
		}
		const countRows = await base
			.clone()
			.select("request.status", "status")
			.addSelect("count(*)::int", "count")
			.groupBy("request.status")
			.getRawMany<{ status: RequestStatus; count: number }>();
		const counts = Object.fromEntries(
			ALL_STATUSES.map((entry) => [entry, countRows.find((row) => row.status === entry)?.count ?? 0]),
		);

		if (ALL_STATUSES.includes(status as RequestStatus)) {
			base.andWhere("request.status = :status", { status });
		}
		const take = Math.min(Math.max(Number.isInteger(limit) ? limit : 24, 1), MAX_PAGE);
		const [items, total] = await base
			.orderBy("request.created_at", "DESC")
			.skip(Math.max(offset, 0))
			.take(take)
			.getManyAndCount();
		return { total, counts, items: await this.toViews(items) };
	}

	async approve(admin: PublicUser, id: string, overrides: ApproveRequestBody = {}): Promise<MediaRequestView> {
		const request = await this.find(id);
		if (request.status !== "pending" && request.status !== "declined") {
			throw new BadRequest("Only pending or declined requests can be approved.");
		}
		if (overrides.serviceId) {
			request.serviceId = overrides.serviceId;
		}
		request.qualityProfileId = overrides.qualityProfileId ?? request.qualityProfileId;
		request.rootFolder = overrides.rootFolder?.trim() || request.rootFolder;
		request.declineReason = null;
		await this.process(request, admin.id);
		return (await this.toViews([await this.find(id)]))[0];
	}

	async retry(admin: PublicUser, id: string): Promise<MediaRequestView> {
		const request = await this.find(id);
		if (request.status !== "failed" && request.status !== "approved") {
			throw new BadRequest("Only failed requests can be retried.");
		}
		await this.process(request, admin.id);
		return (await this.toViews([await this.find(id)]))[0];
	}

	async decline(admin: PublicUser, id: string, reason: string | null | undefined): Promise<MediaRequestView> {
		const request = await this.find(id);
		if (request.status === "available") {
			throw new BadRequest("This request has already been fulfilled.");
		}
		request.status = "declined";
		request.declineReason = reason?.trim() || null;
		request.processedBy = admin.id;
		request.error = null;
		await this.dataSource.getRepository(MediaRequest).save(request);
		await this.notifyRequester(
			request,
			"Request declined",
			`${request.title} was declined${request.declineReason ? `: ${request.declineReason}` : "."}`,
		);
		return (await this.toViews([request]))[0];
	}

	async remove(user: PublicUser, id: string): Promise<void> {
		const request = await this.find(id);
		if (user.role !== "admin" && (request.userId !== user.id || request.status !== "pending")) {
			throw new Forbidden("You can only cancel your own pending requests.");
		}
		await this.dataSource.getRepository(MediaRequest).remove(request);
	}

	private async find(id: string): Promise<MediaRequest> {
		const request = await this.dataSource.getRepository(MediaRequest).findOneBy({ id });
		if (!request) {
			throw new NotFound("Request not found.");
		}
		return request;
	}

	/** Sends the request to Sonarr, Radarr or Lidarr; on failure the request is marked failed so an admin can retry it. */
	private async process(request: MediaRequest, processedBy: string): Promise<void> {
		const repository = this.dataSource.getRepository(MediaRequest);
		request.processedBy = processedBy;
		try {
			const kind = KIND_OF[request.type];
			const service = await this.services.resolve(kind, request.serviceId);
			if (!service) {
				throw new ArrError(`No ${kind} server is configured. Add one in the admin dashboard.`);
			}
			const client = clientFor(service);
			const target = targetOf(service, {
				qualityProfileId: request.qualityProfileId,
				rootFolder: request.rootFolder,
			});
			if (request.type === "movie") {
				await client.addMovie(Number(request.externalId), target);
			} else if (request.type === "tv") {
				const tvdbId = await this.metadata.tvdbIdOfShow(request.externalId);
				if (tvdbId === null) {
					throw new ArrError("This show has no TVDB id, which Sonarr needs.");
				}
				await client.addSeries(tvdbId, request.seasons, target);
			} else {
				await client.addAlbum(request.title, request.artist, target);
			}
			request.serviceId = service.id;
			request.status = "approved";
			request.error = null;
		} catch (error: unknown) {
			request.status = "failed";
			request.error = (error instanceof Error ? error.message : "The request could not be sent.").slice(0, 500);
			logger().warn(`Request ${request.id} (${request.title}) failed: ${request.error}`);
		}
		await repository.save(request);
		if (request.status === "approved") {
			await this.notifyRequester(request, "Request approved", `${request.title} was approved and is on its way.`);
		}
	}

	/** Marks approved requests as available once the title shows up in the library, and tells the requester. */
	async syncAvailability(): Promise<number> {
		if (this.syncing || !(await this.settings()).enabled) {
			return 0;
		}
		this.syncing = true;
		try {
			const repository = this.dataSource.getRepository(MediaRequest);
			const approved = await repository.find({ where: { status: "approved" }, take: 500 });
			if (approved.length === 0) {
				return 0;
			}
			const matches = await this.libraryMatches(
				approved.map((request) => ({
					type: request.type,
					id: request.externalId,
					title: request.title,
					year: request.year,
					source: request.source,
				})),
			);
			let changed = 0;
			for (const request of approved) {
				if (matches.has(cardKey(request.type, request.externalId))) {
					request.status = "available";
					await repository.save(request);
					await this.notifyRequester(
						request,
						"Now available",
						`${request.title} is now in your library.`,
						`/media/${matches.get(cardKey(request.type, request.externalId))}`,
					);
					changed += 1;
				}
			}
			return changed;
		} finally {
			this.syncing = false;
		}
	}

	private async notifyRequester(
		request: MediaRequest,
		title: string,
		body: string,
		url = "/requests",
	): Promise<void> {
		if (!(await this.settings()).notifyUsers) {
			return;
		}
		await this.notifications
			.send({ title, body: body.slice(0, 500), url, kind: "request" }, [request.userId])
			.catch((error: unknown) => logger().warn("Could not notify the requester.", error));
	}

	private async notifyAdmins(request: MediaRequest, user: PublicUser): Promise<void> {
		const admins = await this.dataSource
			.getRepository(User)
			.find({ select: { id: true }, where: { role: "admin" } });
		if (admins.length === 0) {
			return;
		}
		await this.notifications
			.send(
				{
					title: "New request",
					body: `${user.displayName || user.username} requested ${request.title}.`.slice(0, 500),
					url: "/requests",
					kind: "request",
				},
				admins.map((admin) => admin.id),
			)
			.catch((error: unknown) => logger().warn("Could not notify the administrators.", error));
	}

	private async toViews(requests: MediaRequest[]): Promise<MediaRequestView[]> {
		if (requests.length === 0) {
			return [];
		}
		const users = await this.dataSource
			.getRepository(User)
			.find({
				select: { id: true, username: true, displayName: true },
				where: { id: In([...new Set(requests.map((request) => request.userId))]) },
			});
		const serviceIds = [
			...new Set(requests.map((request) => request.serviceId).filter((id): id is string => id !== null)),
		];
		const services = serviceIds.length > 0 ? await this.services.list() : [];
		return requests.map((request) => {
			const owner = users.find((entry) => entry.id === request.userId);
			return {
				id: request.id,
				type: request.type,
				source: request.source,
				externalId: request.externalId,
				title: request.title,
				year: request.year,
				poster: cachedImageUrl(request.poster),
				seasons: request.seasons,
				status: request.status,
				requestedBy: {
					id: request.userId,
					username: owner?.username ?? "",
					displayName: owner?.displayName ?? null,
				},
				serviceName: services.find((service) => service.id === request.serviceId)?.name ?? null,
				declineReason: request.declineReason,
				error: request.error,
				createdAt: request.createdAt,
				updatedAt: request.updatedAt,
			};
		});
	}

	async listUserLimits(): Promise<RequestUserLimitView[]> {
		const [users, limits] = await Promise.all([
			this.dataSource
				.getRepository(User)
				.find({
					select: { id: true, username: true, displayName: true, role: true },
					order: { username: "ASC" },
				}),
			this.dataSource.getRepository(RequestUserLimit).find(),
		]);
		return users.map((user) =>
			this.limitView(
				user,
				limits.find((limit) => limit.userId === user.id),
			),
		);
	}

	async updateUserLimit(userId: string, input: RequestUserLimitInput): Promise<RequestUserLimitView> {
		const user = await this.dataSource
			.getRepository(User)
			.findOne({ select: { id: true, username: true, displayName: true, role: true }, where: { id: userId } });
		if (!user) {
			throw new NotFound("User not found.");
		}
		const quotaLimit = input.quotaLimit ?? null;
		const quotaDays = input.quotaDays ?? null;
		if (quotaLimit !== null && (quotaLimit < 0 || quotaLimit > MAX_QUOTA_LIMIT)) {
			throw new BadRequest(`The quota must be from 0 (unlimited) to ${MAX_QUOTA_LIMIT}.`);
		}
		if (quotaDays !== null && (quotaDays < 1 || quotaDays > MAX_QUOTA_DAYS)) {
			throw new BadRequest(`The quota period must be from 1 to ${MAX_QUOTA_DAYS} days.`);
		}
		const repository = this.dataSource.getRepository(RequestUserLimit);
		const limit = (await repository.findOneBy({ userId })) ?? repository.create({ userId });
		limit.canRequest = input.canRequest ?? null;
		limit.autoApprove = input.autoApprove ?? null;
		limit.quotaLimit = quotaLimit;
		limit.quotaDays = quotaDays;
		await repository.save(limit);
		return this.limitView(user, limit);
	}

	private limitView(user: User, limit: RequestUserLimit | undefined): RequestUserLimitView {
		return {
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			role: user.role,
			canRequest: limit?.canRequest ?? null,
			autoApprove: limit?.autoApprove ?? null,
			quotaLimit: limit?.quotaLimit ?? null,
			quotaDays: limit?.quotaDays ?? null,
		};
	}
}
