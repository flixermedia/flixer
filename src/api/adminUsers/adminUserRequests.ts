import { Enum, Format, MaxLength, MinLength, Pattern, Property, Required } from "@tsed/schema";
import type { UserRole } from "../../entities/user.entity.js";

export class CreateAdminUserRequest {

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

	@Property()
	@Enum("admin", "user")
	role?: UserRole;
}

export class UpdateAdminUserRequest {

	@Property()
	@MinLength(1)
	@MaxLength(64)
	displayName?: string;

	@Property()
	@Format("email")
	@MaxLength(254)
	email?: string;

	@Property()
	@Enum("admin", "user")
	role?: UserRole;

	@Property()
	disabled?: boolean;
}

export class SetUserPasswordRequest {

	@Property()
	@Required()
	@MinLength(8)
	@MaxLength(128)
	password!: string;
}
