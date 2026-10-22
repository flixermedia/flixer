import { CollectionOf, Integer, MaxLength, Minimum, Nullable, Pattern, Property, Required } from "@tsed/schema";

const LANGUAGE_PATTERN = "^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4})?$";

/** Search OpenSubtitles for an item. Without a query the item's own ids and file hash are used. */
export class SubtitleSearchRequest {

	@Property()
	@MaxLength(200)
	query?: string;

	@CollectionOf(String)
	@Pattern(LANGUAGE_PATTERN)
	languages?: string[];
}

/** Download one OpenSubtitles result next to the item's media file. */
export class SubtitleDownloadRequest {

	@Required()
	@Integer()
	@Minimum(1)
	fileId!: number;

	@Required()
	@Pattern(LANGUAGE_PATTERN)
	language!: string;
}

/** A playback position reported by a player. */
export class WatchProgressRequest {

	@Required()
	@Integer()
	@Minimum(0)
	positionSeconds!: number;

	@Required()
	@Integer()
	@Minimum(0)
	durationSeconds!: number;
}

/** Fields an admin can correct on a scanned item. Omitted fields are left alone; null clears an optional one. */
export class UpdateMediaItemRequest {

	@Property()
	@MaxLength(1000)
	title?: string;

	@Nullable(String)
	@MaxLength(1000)
	sortTitle?: string | null;

	@Nullable(Number)
	@Integer()
	@Minimum(0)
	year?: number | null;

	@Nullable(Number)
	@Integer()
	@Minimum(0)
	seasonNumber?: number | null;

	@Nullable(Number)
	@Integer()
	@Minimum(0)
	episodeNumber?: number | null;

	@Nullable(Number)
	@Integer()
	@Minimum(0)
	episodeEndNumber?: number | null;

	@Nullable(String)
	@MaxLength(20000)
	overview?: string | null;
}
