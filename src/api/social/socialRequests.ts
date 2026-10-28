import {
	CollectionOf,
	Enum,
	Maximum,
	MaxItems,
	MaxLength,
	Minimum,
	MinLength,
	Nullable,
	Property,
	Required,
} from "@tsed/schema";

export class CreatePlaylistRequest {
	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@Property()
	@Nullable(String)
	@MaxLength(500)
	description?: string | null;

	@Property()
	isPublic?: boolean;
}

export class UpdatePlaylistRequest {
	@Property()
	@MinLength(1)
	@MaxLength(100)
	name?: string;

	@Property()
	@Nullable(String)
	@MaxLength(500)
	description?: string | null;

	@Property()
	isPublic?: boolean;
}

export class PlaylistItemRequest {
	@Required()
	@MaxLength(36)
	itemId!: string;
}

export class PlaylistOrderRequest {
	@Required()
	@CollectionOf(String)
	@MaxItems(5000)
	itemIds!: string[];
}

export class UpdateProfileVisibilityRequest {
	@Required()
	@Enum("public", "hidden", "friends")
	visibility!: "public" | "hidden" | "friends";
}

export class ListeningReportRequest {
	@Required()
	@MaxLength(36)
	itemId!: string;

	@Required()
	@Enum("playing", "stopped")
	state!: "playing" | "stopped";

	@Property()
	positionSeconds?: number;
}

export class CreatePartyRequest {
	@Required()
	@MaxLength(36)
	itemId!: string;

	@Property()
	@Enum("public", "friends", "private")
	visibility?: "public" | "friends" | "private";
}

export class CreateFriendInviteRequest {
	@Required()
	@Enum("once", "unlimited", "expires")
	mode!: "once" | "unlimited" | "expires";

	@Property()
	@Minimum(1)
	@Maximum(8760)
	expiresInHours?: number;
}
