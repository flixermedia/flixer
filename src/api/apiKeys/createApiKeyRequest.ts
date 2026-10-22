import { MaxLength, MinLength, Property, Required } from "@tsed/schema";

export class CreateApiKeyRequest {

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;
}
