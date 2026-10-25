import {
	CollectionOf,
	Enum,
	Integer,
	MaxItems,
	MaxLength,
	MinLength,
	Nullable,
	Property,
	Required,
} from "@tsed/schema";
import type { RequestMediaType } from "../../entities/mediaRequest.entity.js";
import type { RequestServiceKind } from "../../entities/requestService.entity.js";

export class CreateMediaRequest {

	@Required()
	@Enum("movie", "tv", "music")
	type!: RequestMediaType;

	@Required()
	@MinLength(1)
	@MaxLength(12)
	externalId!: string;

	/** TV only: the seasons to request; every season when omitted. */
	@CollectionOf(Number)
	@MaxItems(200)
	seasons?: number[];

	@Property()
	@MaxLength(36)
	serviceId?: string;

	@Integer()
	qualityProfileId?: number;

	@Property()
	@MaxLength(500)
	rootFolder?: string;
}

export class ApproveRequestBody {

	@Property()
	@MaxLength(36)
	serviceId?: string;

	@Integer()
	qualityProfileId?: number;

	@Property()
	@MaxLength(500)
	rootFolder?: string;
}

export class DeclineRequestBody {

	@Property()
	@Nullable(String)
	@MaxLength(500)
	reason?: string | null;
}

export class RequestServiceInput {

	@Required()
	@Enum("sonarr", "radarr", "lidarr")
	kind!: RequestServiceKind;

	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@Required()
	@MaxLength(500)
	url!: string;

	@Property()
	@MaxLength(200)
	apiKey?: string;

	@Property()
	isDefault?: boolean;

	@Property()
	enabled?: boolean;

	/** The Flixer library this server fills. */
	@Required()
	@MaxLength(36)
	libraryId!: string;

	@Required()
	@MaxLength(500)
	rootFolder!: string;

	@Required()
	@Integer()
	qualityProfileId!: number;

	@Integer()
	@Nullable(Number)
	metadataProfileId?: number | null;

	@Integer()
	@Nullable(Number)
	languageProfileId?: number | null;

	@Property()
	@Nullable(String)
	@MaxLength(16)
	minimumAvailability?: string | null;

	@Property()
	seasonFolders?: boolean;

	@CollectionOf(Number)
	@MaxItems(50)
	tags?: number[];
}

export class TestServiceInput {

	@Required()
	@Enum("sonarr", "radarr", "lidarr")
	kind!: RequestServiceKind;

	@Required()
	@MaxLength(500)
	url!: string;

	@Property()
	@MaxLength(200)
	apiKey?: string;

	@Property()
	@MaxLength(36)
	serviceId?: string;
}

export class RequestUserLimitInput {

	@Property()
	@Nullable(Boolean)
	canRequest?: boolean | null;

	@Property()
	@Nullable(Boolean)
	autoApprove?: boolean | null;

	@Integer()
	@Nullable(Number)
	quotaLimit?: number | null;

	@Integer()
	@Nullable(Number)
	quotaDays?: number | null;
}
