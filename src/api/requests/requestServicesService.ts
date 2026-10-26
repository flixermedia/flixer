import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, IsNull, Not } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import {
	REQUEST_SERVICE_KINDS,
	RequestService,
	type RequestServiceKind,
} from "../../entities/requestService.entity.js";
import { SECRET_MASK } from "../settings/secretMask.js";
import { type ArrTarget, type ArrTestResult, ArrClient, normalizeArrUrl } from "./arrClient.js";
import type { RequestServiceInput, TestServiceInput } from "./requestRequests.js";

export interface RequestServiceView {
	id: string;
	kind: RequestServiceKind;
	name: string;
	url: string;
	hasKey: boolean;
	isDefault: boolean;
	enabled: boolean;
	libraryId: string | null;
	libraryName: string | null;
	rootFolder: string;
	qualityProfileId: number;
	metadataProfileId: number | null;
	languageProfileId: number | null;
	minimumAvailability: string | null;
	seasonFolders: boolean;
	tags: number[];
}

/** Library types each kind of server can fill. */
export const LIBRARY_TYPES_OF: Record<RequestServiceKind, string[]> = {
	radarr: ["movies", "mixed"],
	sonarr: ["tvshows", "mixed"],
	lidarr: ["music", "mixed"],
};

const MIN_AVAILABILITY = ["announced", "inCinemas", "released"];

export function toServiceView(service: RequestService, libraries: Map<string, string> = new Map()): RequestServiceView {
	return {
		id: service.id,
		kind: service.kind,
		name: service.name,
		url: service.url,
		hasKey: service.apiKey !== "",
		isDefault: service.isDefault,
		enabled: service.enabled,
		libraryId: service.libraryId,
		libraryName: service.libraryId ? (libraries.get(service.libraryId) ?? null) : null,
		rootFolder: service.rootFolder,
		qualityProfileId: service.qualityProfileId,
		metadataProfileId: service.metadataProfileId,
		languageProfileId: service.languageProfileId,
		minimumAvailability: service.minimumAvailability,
		seasonFolders: service.seasonFolders,
		tags: service.tags,
	};
}

export function clientFor(service: RequestService): ArrClient {
	return new ArrClient(service.kind, service.url, service.apiKey);
}

export function targetOf(
	service: RequestService,
	overrides: { qualityProfileId?: number | null; rootFolder?: string | null } = {},
): ArrTarget {
	return {
		rootFolder: overrides.rootFolder || service.rootFolder,
		qualityProfileId: overrides.qualityProfileId ?? service.qualityProfileId,
		metadataProfileId: service.metadataProfileId,
		languageProfileId: service.languageProfileId,
		minimumAvailability: service.minimumAvailability,
		seasonFolders: service.seasonFolders,
		tags: service.tags,
	};
}

/** The Sonarr, Radarr and Lidarr instances approved requests are sent to. */
@Injectable()
export class RequestServicesService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list(): Promise<RequestServiceView[]> {
		const services = await this.dataSource
			.getRepository(RequestService)
			.find({ order: { kind: "ASC", name: "ASC" } });
		const libraries = new Map(
			(await this.dataSource.getRepository(MediaLibrary).find({ select: { id: true, name: true } })).map(
				(library) => [library.id, library.name],
			),
		);
		return services.map((service) => toServiceView(service, libraries));
	}

	/** The kinds of server that can take requests: enabled and linked to a library. */
	async usableKinds(): Promise<Set<RequestServiceKind>> {
		const services = await this.dataSource
			.getRepository(RequestService)
			.find({ select: { kind: true }, where: { enabled: true, libraryId: Not(IsNull()) } });
		return new Set(services.map((service) => service.kind));
	}

	async get(id: string): Promise<RequestService> {
		const service = await this.dataSource.getRepository(RequestService).findOneBy({ id });
		if (!service) {
			throw new NotFound("Server not found.");
		}
		return service;
	}

	/** The server a request goes to: the chosen one, otherwise the default (or only) enabled server of that kind. */
	async resolve(kind: RequestServiceKind, serviceId?: string | null): Promise<RequestService | null> {
		const repository = this.dataSource.getRepository(RequestService);
		if (serviceId) {
			const chosen = await repository.findOneBy({ id: serviceId });
			if (!chosen || chosen.kind !== kind || !chosen.enabled) {
				throw new BadRequest(`The chosen server is not an enabled ${kind} server.`);
			}
			if (chosen.libraryId === null) {
				throw new BadRequest("The chosen server is not linked to a library.");
			}
			return chosen;
		}
		const candidates = await repository.find({
			where: { kind, enabled: true, libraryId: Not(IsNull()) },
			order: { isDefault: "DESC", createdAt: "ASC" },
		});
		return candidates[0] ?? null;
	}

	async create(input: RequestServiceInput): Promise<RequestServiceView> {
		const apiKey = input.apiKey?.trim();
		if (!apiKey || apiKey === SECRET_MASK) {
			throw new BadRequest("An API key is required.");
		}
		const service = new RequestService();
		service.id = randomUUID();
		service.apiKey = apiKey;
		return this.save(service, input);
	}

	async update(id: string, input: RequestServiceInput): Promise<RequestServiceView> {
		const service = await this.get(id);
		const apiKey = input.apiKey?.trim();
		if (apiKey && apiKey !== SECRET_MASK) {
			service.apiKey = apiKey;
		}
		return this.save(service, input);
	}

	async remove(id: string): Promise<void> {
		const service = await this.get(id);
		await this.dataSource.getRepository(RequestService).remove(service);
	}

	async test(input: TestServiceInput): Promise<ArrTestResult> {
		if (!REQUEST_SERVICE_KINDS.includes(input.kind)) {
			throw new BadRequest("Unknown server type.");
		}
		const url = normalizeArrUrl(input.url);
		if (!url) {
			throw new BadRequest("Enter the server address as an http(s) URL.");
		}
		let apiKey = input.apiKey?.trim() ?? "";
		if ((apiKey === "" || apiKey === SECRET_MASK) && input.serviceId) {
			apiKey = (await this.get(input.serviceId)).apiKey;
		}
		if (!apiKey) {
			throw new BadRequest("An API key is required.");
		}
		return new ArrClient(input.kind, url, apiKey).test();
	}

	private async save(service: RequestService, input: RequestServiceInput): Promise<RequestServiceView> {
		if (!REQUEST_SERVICE_KINDS.includes(input.kind)) {
			throw new BadRequest("Unknown server type.");
		}
		const url = normalizeArrUrl(input.url);
		if (!url) {
			throw new BadRequest("Enter the server address as an http(s) URL.");
		}
		const library = await this.dataSource.getRepository(MediaLibrary).findOneBy({ id: input.libraryId });
		if (!library) {
			throw new BadRequest("Choose the library this server fills.");
		}
		if (!LIBRARY_TYPES_OF[input.kind].includes(library.type)) {
			throw new BadRequest(
				`A ${input.kind} server needs a ${LIBRARY_TYPES_OF[input.kind].join(" or ")} library.`,
			);
		}
		const rootFolder = input.rootFolder.trim();
		if (!rootFolder) {
			throw new BadRequest("Choose a root folder.");
		}
		if (input.kind === "lidarr" && !Number.isInteger(input.metadataProfileId)) {
			throw new BadRequest("Lidarr needs a metadata profile.");
		}
		if (input.minimumAvailability && !MIN_AVAILABILITY.includes(input.minimumAvailability)) {
			throw new BadRequest("Unknown minimum availability.");
		}

		service.kind = input.kind;
		service.name = input.name.trim();
		service.url = url;
		service.enabled = input.enabled !== false;
		service.libraryId = library.id;
		service.rootFolder = rootFolder;
		service.qualityProfileId = input.qualityProfileId;
		service.metadataProfileId = input.kind === "lidarr" ? (input.metadataProfileId ?? null) : null;
		service.languageProfileId = input.kind === "sonarr" ? (input.languageProfileId ?? null) : null;
		service.minimumAvailability = input.kind === "radarr" ? (input.minimumAvailability ?? "released") : null;
		service.seasonFolders = input.seasonFolders !== false;
		service.tags = (input.tags ?? []).filter((tag) => Number.isInteger(tag));

		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(RequestService);
			const others = await repository.countBy({ kind: service.kind });
			const existing = await repository.findOneBy({ id: service.id });
			const first = others === 0 || (others === 1 && existing?.kind === service.kind);
			service.isDefault = input.isDefault === true || first;
			if (service.isDefault) {
				const siblings = await repository.find({ where: { kind: service.kind, isDefault: true } });
				for (const sibling of siblings.filter((entry) => entry.id !== service.id)) {
					sibling.isDefault = false;
					await repository.save(sibling);
				}
			}
			const saved = await repository.save(service);
			return toServiceView(saved, new Map([[library.id, library.name]]));
		});
	}
}
