import { CollectionOf, Enum, MaxItems, MaxLength, Max, Min, MinLength, Nullable, Property, Required } from "@tsed/schema";

export class UpdateMailSettingsRequest {
	@Property() inboundEnabled?: boolean;

	@Property() @Min(1) @Max(65535) inboundPort?: number;

	@Property() @Nullable(String) @MaxLength(253) hostname?: string | null;

	@Property() @Min(1) @Max(50) maxMessageMb?: number;

	@Property() outboundEnabled?: boolean;

	@Property() relayFallback?: boolean;

	@Property() @Nullable(String) @MaxLength(320) noreplyAddress?: string | null;

	@Property() @MaxLength(100) noreplyName?: string;

	@Property() userAddressesEnabled?: boolean;

	@Property() @Enum("username", "random") userAddressMode?: "username" | "random";

	@Property() @Nullable(String) @MaxLength(253) userAddressDomain?: string | null;
}

export class CreateMailDomainRequest {
	@Property() @Required() @MinLength(3) @MaxLength(253) domain!: string;

	@Property() allowSubdomains?: boolean;
}

export class UpdateMailDomainRequest {
	@Property() allowSubdomains?: boolean;
}

export class CreateMailboxRequest {
	@Property() @Required() @MinLength(3) @MaxLength(320) address!: string;

	@Property() @Nullable(String) @MaxLength(100) displayName?: string | null;
}

export class UpdateMailboxRequest {
	@Property() @Nullable(String) @MaxLength(100) displayName?: string | null;

	@Property() enabled?: boolean;
}

export class SendMailRequest {
	@Property() @Required() @MinLength(3) @MaxLength(320) from!: string;

	@Property() @Required() @CollectionOf(String) @MaxItems(20) to!: string[];

	@Property() @Required() @MinLength(1) @MaxLength(300) subject!: string;

	@Property() @Required() @MaxLength(100_000) text!: string;

	@Property() @Nullable(String) @MaxLength(400_000) html?: string | null;

	@Property() @Nullable(String) @MaxLength(998) inReplyTo?: string | null;
}

export class SaveMailTemplateRequest {
	@Property() @MaxLength(100) label?: string;

	@Property() @MaxLength(300) description?: string;

	@Property() @Required() @MinLength(1) @MaxLength(200) subject!: string;

	@Property() @Required() @MaxLength(262_144) html!: string;

	@Property() @Required() @MaxLength(65_536) text!: string;
}

export class PreviewMailTemplateRequest {
	@Property() @Required() @MaxLength(200) subject!: string;

	@Property() @Required() @MaxLength(262_144) html!: string;

	@Property() @Required() @MaxLength(65_536) text!: string;

	@Property() variables?: Record<string, string>;
}

export class SendTestMailRequest {
	@Property() @Required() @MaxLength(320) to!: string;
}
