import { CollectionOf, Enum, Format, Integer, MaxLength, Min, MinLength, Nullable, Pattern, Property, Required } from "@tsed/schema";
import type { InviteServerType } from "../../entities/inviteServer.entity.js";
import type { LibraryAccessMode } from "../../entities/userAccessPolicy.entity.js";

export class CreateInviteServerRequest {
	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@Property()
	@Required()
	@Enum("flixer", "jellyfin", "emby", "plex", "other")
	type!: InviteServerType;

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(500)
	@Pattern(/^https?:\/\/\S+$/)
	url!: string;

	/** Optional public URL shown to invited users; falls back to `url` when empty. */
	@Property()
	@Nullable(String)
	@MaxLength(500)
	@Pattern(/^(|https?:\/\/\S+)$/)
	externalUrl?: string | null;

	/** Jellyfin/Emby API key or Plex token. Stored encrypted and never returned. */
	@Property()
	@MaxLength(500)
	apiKey?: string;

	@Property()
	@MaxLength(2000)
	instructions?: string;

	@Property()
	enabled?: boolean;
}

export class UpdateInviteServerRequest {
	@Property()
	@MinLength(1)
	@MaxLength(100)
	name?: string;

	@Property()
	@MinLength(1)
	@MaxLength(500)
	@Pattern(/^https?:\/\/\S+$/)
	url?: string;

	/** Optional public URL shown to invited users; empty string or null clears it. */
	@Property()
	@Nullable(String)
	@MaxLength(500)
	@Pattern(/^(|https?:\/\/\S+)$/)
	externalUrl?: string | null;

	/** Replaces the saved key; an empty string removes it. */
	@Property()
	@MaxLength(500)
	apiKey?: string;

	@Property()
	@MaxLength(2000)
	instructions?: string;

	@Property()
	enabled?: boolean;
}

export class CreateInvitationRequest {
	/** Generated when left out. */
	@Property()
	@MinLength(4)
	@MaxLength(64)
	@Pattern(/^[a-zA-Z0-9-]+$/)
	code?: string;

	@Property()
	@MaxLength(100)
	label?: string;

	/** The media server to also create an account on; leave out to invite to Flixer only. */
	@Property()
	@MaxLength(36)
	serverId?: string;

	@Property()
	@Integer()
	@Min(1)
	maxUses?: number;

	@Property()
	@Format("date-time")
	expiresAt?: Date;

	@Property()
	@Enum("all", "selected")
	libraryMode?: LibraryAccessMode;

	@Property()
	@CollectionOf(String)
	libraryIds?: string[];

	@Property()
	@CollectionOf(String)
	externalLibraryIds?: string[];

	@Property()
	allowDownloads?: boolean;

	@Property()
	skipPayment?: boolean;

	@Property()
	skipEmailVerification?: boolean;

	@Property()
	disablePlexOnlineSources?: boolean;

	@Property()
	@Integer()
	@Min(1)
	userExpiresInDays?: number;
}

export class UpdateInvitationRequest {
	@Property()
	@MinLength(4)
	@MaxLength(64)
	@Pattern(/^[a-zA-Z0-9-]+$/)
	code?: string;

	@Property()
	@Nullable(String)
	@MaxLength(100)
	label?: string | null;

	/** Null switches the invitation to Flixer only. Only allowed before any redemptions. */
	@Property()
	@Nullable(String)
	@MaxLength(36)
	serverId?: string | null;

	/** Null removes the limit. */
	@Property()
	@Nullable(Number)
	@Integer()
	@Min(1)
	maxUses?: number | null;

	/** Null removes the expiry. */
	@Property()
	@Nullable(Date)
	@Format("date-time")
	expiresAt?: Date | null;

	@Property()
	disabled?: boolean;

	@Property()
	@Enum("all", "selected")
	libraryMode?: LibraryAccessMode;

	@Property()
	@CollectionOf(String)
	libraryIds?: string[];

	@Property()
	@CollectionOf(String)
	externalLibraryIds?: string[];

	@Property()
	allowDownloads?: boolean;

	@Property()
	skipPayment?: boolean;

	@Property()
	skipEmailVerification?: boolean;

	@Property()
	disablePlexOnlineSources?: boolean;

	/** Null removes the account expiry for future redemptions. */
	@Property()
	@Nullable(Number)
	@Integer()
	@Min(1)
	userExpiresInDays?: number | null;
}

export class AcceptInvitationRequest {
	@Property()
	@Required()
	@MinLength(3)
	@MaxLength(64)
	@Pattern(/^[a-zA-Z0-9_.-]+$/)
	username!: string;

	@Property()
	@MinLength(1)
	@MaxLength(64)
	displayName?: string;

	@Property()
	@Required()
	@Format("email")
	@MaxLength(254)
	email!: string;

	@Property()
	@Required()
	@MinLength(8)
	@MaxLength(128)
	password!: string;
}

export class PlexInvitePollRequest {
	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(4096)
	sessionToken!: string;
}

export class AcceptPlexInvitationRequest {
	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(8192)
	plexAuthTicket!: string;
}

export class LoginInvitationRequest {
	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(254)
	username!: string;

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(128)
	password!: string;
}

export class ResendInviteVerificationRequest {
	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(2048)
	resendToken!: string;
}
