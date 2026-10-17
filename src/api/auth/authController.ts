import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Controller } from "@tsed/di";
import { Delete, Get, Post, Security } from "@tsed/schema";
import { AuthService } from "./authService.js";
import { LoginRequest } from "./loginRequest.js";
import { RegisterRequest } from "./registerRequest.js";

@Controller("/auth")
export class AuthController {

	constructor(private readonly authService: AuthService) {}

	@Post("/register")
	register(@BodyParams() request: RegisterRequest) {
		return this.authService.register(request.username, request.password, request.email);
	}

	@Post("/login")
	login(@BodyParams() request: LoginRequest) {
		return this.authService.login(request.username, request.password);
	}

	@Get("/sessions")
	@Security("BearerAuth")
	listSessions(@HeaderParams("authorization") authorization?: string) {
		return this.authService.listSessions(authorization);
	}

	@Delete("/sessions/:sessionId")
	@Security("BearerAuth")
	revokeSession(@PathParams("sessionId") sessionId: string, @HeaderParams("authorization") authorization?: string) {
		return this.authService.revokeSession(sessionId, authorization);
	}

	@Post("/logout")
	@Security("BearerAuth")
	logout(@HeaderParams("authorization") authorization?: string) {
		return this.authService.logout(authorization);
	}
}
