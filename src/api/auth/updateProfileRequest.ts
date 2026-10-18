import { Format, MaxLength, MinLength, Property } from "@tsed/schema";

export class UpdateProfileRequest {

	@Property()
	@MinLength(1)
	@MaxLength(64)
	displayName?: string;

	@Property()
	@Format("email")
	@MaxLength(254)
	email?: string;
}
