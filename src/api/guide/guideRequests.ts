import { CollectionOf, Enum, Format, MaxItems, MaxLength, Max, Min, MinLength, Nullable, Property, Required } from "@tsed/schema";
import type { GuideSourceKind } from "../../entities/guideSource.entity.js";

export class CreateGuideSourceRequest {
	@Property()
	@Required()
	@Enum("epg", "iptv")
	kind!: GuideSourceKind;

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@Property()
	@Required()
	@MaxLength(2048)
	url!: string;
}

export class UpdateGuideSourceRequest {
	@Property()
	@MinLength(1)
	@MaxLength(100)
	name?: string;

	@Property()
	@MaxLength(2048)
	url?: string;

	@Property()
	enabled?: boolean;

	@Property()
	@Min(0)
	@Max(10000)
	sortOrder?: number;
}

export class UpdateGuideSettingsRequest {
	@Property()
	@Required()
	@Min(1)
	@Max(100)
	regionalMergeThresholdPercent!: number;
}

export class GuideChannelChange {
	@Property()
	@Required()
	@Format("uuid")
	id!: string;

	@Property()
	enabled?: boolean;

	@Property()
	@Min(0)
	@Max(100000)
	sortOrder?: number;

	@Property()
	@Format("uuid")
	@Nullable(String)
	iptvChannelId?: string | null;
}

export class UpdateGuideChannelsRequest {
	@Property()
	@Required()
	@CollectionOf(GuideChannelChange)
	@MaxItems(1000)
	channels!: GuideChannelChange[];
}
