import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Unauthorized } from "@tsed/exceptions";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { IndexerClient } from "../indexer/indexerClient.js";
import { MediaLibrariesService } from "../mediaLibraries/mediaLibrariesService.js";
import { REQUEST_SERVICE_KINDS, type RequestServiceKind } from "../../entities/requestService.entity.js";
import { RequestServicesService } from "./requestServicesService.js";

const TOKEN_SETTING_KEY = "requests_webhook_token";
export const REQUEST_WEBHOOK_USERNAME = "flixer";
const COMPLETION_EVENTS = new Set(["download", "import", "importcomplete"]);
const MAX_REFRESH_TARGETS = 100;

export interface RequestWebhookCredentials {
	username: string;
	password: string;
}

export interface WebhookTarget {
	path: string;
	itemType: "movie" | "episode" | "track" | "album";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function pathOf(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isWithin(root: string, target: string): boolean {

	const relativePath = relative(resolve(root), resolve(target));
	return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));

}

export function extractWebhookTargets(kind: RequestServiceKind, payload: unknown): WebhookTarget[] {

	if (!isRecord(payload)) throw new BadRequest("The webhook body must be a JSON object.");
	const eventType = typeof payload.eventType === "string" ? payload.eventType.trim().toLowerCase() : "";
	if (!COMPLETION_EVENTS.has(eventType)) return [];

	const targets: WebhookTarget[] = [];
	const add = (path: unknown, itemType: WebhookTarget["itemType"]) => {
		const candidate = pathOf(path);
		if (candidate) targets.push({ path: candidate, itemType });
	};

	if (kind === "radarr") {
		add(record(payload.movieFile).path, "movie");
	} else if (kind === "sonarr") {
		const episodeFile = record(payload.episodeFile);
		const series = record(payload.series);
		add(episodeFile.path, "episode");
		const relativePath = pathOf(episodeFile.relativePath);
		const seriesPath = pathOf(series.path);
		if (targets.length === 0 && relativePath && seriesPath) {
			add(resolve(seriesPath, relativePath), "episode");
		}
	} else {
		const trackFiles = Array.isArray(payload.trackFiles) ? payload.trackFiles : [];
		for (const trackFile of trackFiles) add(isRecord(trackFile) ? trackFile.path : trackFile, "track");
		add(isRecord(payload.trackFile) ? payload.trackFile.path : payload.trackFile, "track");
		if (targets.length === 0) add(record(payload.album).path, "album");
	}

	if (targets.length > MAX_REFRESH_TARGETS) {
		throw new BadRequest(`The webhook may include at most ${MAX_REFRESH_TARGETS} completed media paths.`);
	}
	return targets;

}

function verifyBasicCredentials(header: string | undefined, expectedPassword: string): void {

	const match = header?.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
	if (!match) throw new Unauthorized("Invalid webhook credentials.");
	const decoded = Buffer.from(match[1], "base64").toString("utf8");
	const separator = decoded.indexOf(":");
	if (separator < 0 || decoded.slice(0, separator) !== REQUEST_WEBHOOK_USERNAME) {
		throw new Unauthorized("Invalid webhook credentials.");
	}
	const supplied = Buffer.from(decoded.slice(separator + 1));
	const expected = Buffer.from(expectedPassword);
	if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
		throw new Unauthorized("Invalid webhook credentials.");
	}

}

@Injectable()
export class RequestWebhookService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly services: RequestServicesService,
		private readonly libraries: MediaLibrariesService,
		private readonly indexer: IndexerClient,
	) {}

	async credentials(): Promise<RequestWebhookCredentials> {
		return { username: REQUEST_WEBHOOK_USERNAME, password: await this.token() };
	}

	async rotateCredentials(): Promise<RequestWebhookCredentials> {
		const repository = this.dataSource.getRepository(Setting);
		const setting = await repository.findOneBy({ key: TOKEN_SETTING_KEY });
		if (!setting) throw new Error("The request webhook token setting is missing.");
		setting.value = randomBytes(32).toString("hex");
		const saved = await repository.save(setting);
		if (typeof saved.value !== "string") throw new Error("The request webhook token could not be saved.");
		return { username: REQUEST_WEBHOOK_USERNAME, password: saved.value };
	}

	async receive(kindValue: string, serviceId: string, authorization: string | undefined, payload: unknown) {
		if (!(REQUEST_SERVICE_KINDS as readonly string[]).includes(kindValue)) {
			throw new BadRequest("Unknown request service type.");
		}
		verifyBasicCredentials(authorization, await this.token());
		const kind = kindValue as RequestServiceKind;
		const body = record(payload);
		const eventType = typeof body.eventType === "string" ? body.eventType.trim().toLowerCase() : "";
		if (eventType === "test") return { ok: true, ignored: true, queued: 0, alreadyQueued: 0 };
		const targets = extractWebhookTargets(kind, payload);
		if (targets.length === 0) {
			if (COMPLETION_EVENTS.has(eventType)) {
				throw new BadRequest("The completed notification did not include any media file paths.");
			}
			return { ok: true, ignored: true, queued: 0, alreadyQueued: 0 };
		}

		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceId)) {
			throw new BadRequest("Invalid request service.");
		}
		const service = await this.services.get(serviceId.toLowerCase());
		if (service.kind !== kind || !service.enabled || !service.libraryId) {
			throw new BadRequest("This request service is not enabled and linked to a library.");
		}

		const library = (await this.libraries.forIndexer()).find((entry) => entry.id === service.libraryId);
		if (!library) throw new BadRequest("The request service library is unavailable.");
		const rootFolder = resolve(service.rootFolder);
		if (!isAbsolute(service.rootFolder) || !library.folders.some((folder) => isWithin(folder.absolutePath, rootFolder))) {
			throw new BadRequest("The request service root folder is outside its linked library.");
		}

		const uniqueTargets = new Map<string, WebhookTarget>();
		for (const target of targets) {
			if (!isAbsolute(target.path) || target.path.includes("\0") || !isWithin(rootFolder, target.path)) {
				throw new BadRequest("A completed media path is outside the configured request service root folder.");
			}
			uniqueTargets.set(`${target.itemType}\0${resolve(target.path)}`, { ...target, path: resolve(target.path) });
		}

		let queued = 0;
		let alreadyQueued = 0;
		for (const target of uniqueTargets.values()) {
			const result = await this.indexer.request<{ queued?: boolean; alreadyQueued?: boolean }>("POST", "/internal/refresh", {
				body: { libraryId: service.libraryId, path: target.path, itemType: target.itemType, priority: true },
			});
			if (result.queued) queued++;
			else if (result.alreadyQueued) alreadyQueued++;
		}
		return { ok: true, ignored: false, queued, alreadyQueued };
	}

	private async token(): Promise<string> {
		const setting = await this.dataSource.getRepository(Setting).findOneBy({ key: TOKEN_SETTING_KEY });
		if (!setting || typeof setting.value !== "string" || setting.value.length < 32) {
			throw new Error("The request webhook token setting is missing or invalid.");
		}
		return setting.value;
	}
}
