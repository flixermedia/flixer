import { MaxLength, MinLength, Property, Required } from "@tsed/schema";

export class ChangePasswordRequest {

	@Property()
	@Required()
	@MaxLength(128)
	currentPassword!: string;

	@Property()
	@Required()
	@MinLength(8)
	@MaxLength(128)
	newPassword!: string;
}
