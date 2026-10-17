import { Format, MaxLength, MinLength, Pattern, Property, Required } from "@tsed/schema";

export class RegisterRequest {

	@Property()
	@Required()
	@MinLength(3)
	@MaxLength(64)
	@Pattern(/^[a-zA-Z0-9_.-]+$/)
	username!: string;

	@Property()
	@Format("email")
	@MaxLength(254)
	email?: string;

	@Property()
	@Required()
	@MinLength(8)
	@MaxLength(128)
	password!: string;
}
