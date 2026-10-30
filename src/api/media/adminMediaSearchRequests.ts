import { MaxLength, MinLength, Optional, Property, Required } from "@tsed/schema";

export class MediaSearchSettingsRequest {

	@Property()
	@Required()
	enabled!: boolean;

	@Property()
	@Required()
	@MinLength(0)
	@MaxLength(2048)
	url!: string;
}
