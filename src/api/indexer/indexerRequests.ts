import { Enum, MaxLength, Property, Required } from "@tsed/schema";
import { MEDIA_ITEM_TYPES, type MediaItemType } from "../../entities/mediaItem.entity.js";

export class ScanLibraryRequest {

	/** Re-reads every item instead of only what changed on disk. */
	@Property()
	force?: boolean;

	/** Only generates missing hover-preview thumbnails; nothing is re-indexed. */
	@Property()
	trickplayOnly?: boolean;
}

export class RefreshItemRequest {

	@Property()
	@Required()
	@MaxLength(64)
	libraryId!: string;

	@Property()
	@Required()
	@MaxLength(4096)
	path!: string;

	@Property()
	@Required()
	@Enum(...MEDIA_ITEM_TYPES)
	itemType!: MediaItemType;
}
