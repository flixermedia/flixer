import { MaxLength, MinLength, Property } from "@tsed/schema";

export class DeleteUserRequest {

	@Property()
	@MinLength(8)
	@MaxLength(128)
	password?: string;
}
