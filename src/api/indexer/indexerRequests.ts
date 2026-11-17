import { CollectionOf, Enum, MaxItems, MaxLength, MinItems, Property, Required } from "@tsed/schema";
import { MEDIA_ITEM_TYPES, type MediaItemType } from "../../entities/mediaItem.entity.js";
import { MediaLibraryFolderRequest } from "../mediaLibraries/mediaLibraryRequests.js";

export class ScanLibraryRequest {
	/** Re-reads every item instead of only what changed on disk. */
	@Property()
	force?: boolean;

	/** Only generates missing hover-preview thumbnails; nothing is re-indexed. */
	@Property()
	trickplayOnly?: boolean;

	/** Re-runs only the selected stages and updates only those fields on existing items. */
	@Property()
	jobs?: string[];

	/** Restrict this scan to these library folders and their descendants. */
	@CollectionOf(MediaLibraryFolderRequest)
	@MinItems(1)
	@MaxItems(50)
	folders?: MediaLibraryFolderRequest[];
}

export class LibrarySegmentScanRequest {
	@Property()
	@Required()
	@Enum("movie", "episode")
	type!: "movie" | "episode";
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
