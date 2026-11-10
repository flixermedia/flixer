import { CollectionOf, Enum, MaxLength, MinLength, Property, Required } from "@tsed/schema";

/** Registration details for a third-party OpenID Connect application. */
export class CreateOidcClientRequest {
	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@CollectionOf(String)
	@Required()
	redirectUris!: string[];

	@Property()
	@Required()
	@Enum("public", "confidential")
	type!: "public" | "confidential";
}

/** Public origin used by the OpenID Connect provider. */
export class UpdateOidcConfigurationRequest {
	@Property()
	@Required()
	@MaxLength(2048)
	publicUrl!: string;
}
