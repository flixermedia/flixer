import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { DeleteUserRequest } from "./deleteUserRequest.js";

@Controller("/users")
@Security("BearerAuth")
export class UserController {

	constructor(private readonly authService: AuthService) {}

	@Get("/")
	listUsers(@HeaderParams("authorization") authorization?: string) {
		return this.authService.listUsers(authorization);
	}

	@Get("/:id")
	getUser(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.authService.getUser(id, authorization);
	}

	@Delete("/:id")
	deleteUser(
		@PathParams("id") id: string,
		@HeaderParams("authorization") authorization?: string,
		@BodyParams() request?: DeleteUserRequest,
	) {
		return this.authService.deleteUser(id, authorization, request?.password);
	}
}
