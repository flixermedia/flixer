import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Controller } from "@tsed/di";
import { Delete, Get, Patch, Post, Security } from "@tsed/schema";
import { AuthService } from "./authService.js";
import { ChangePasswordRequest } from "./changePasswordRequest.js";
import { DeleteAccountRequest } from "./deleteAccountRequest.js";
import { LoginRequest } from "./loginRequest.js";
import { RegisterRequest } from "./registerRequest.js";
import { SetPasskeyRequiredRequest } from "./setPasskeyRequiredRequest.js";
import { UpdateProfileRequest } from "./updateProfileRequest.js";
import { VerifyEmailRequest } from "./verifyEmailRequest.js";

@Controller("/auth")
export class AuthController {

	constructor(private readonly authService: AuthService) {}

	@Post("/register")
	register(@BodyParams() request: RegisterRequest, @HeaderParams("authorization") authorization?: string) {
		return this.authService.register(request.username, request.password, request.email, request.displayName, authorization);
	}

	@Get("/me")
	@Security("BearerAuth")
	me(@HeaderParams("authorization") authorization?: string) {
		return this.authService.getAuthenticatedUser(authorization);
	}

	@Patch("/me")
	@Security("BearerAuth")
	updateMe(@BodyParams() request: UpdateProfileRequest, @HeaderParams("authorization") authorization?: string) {
		return this.authService.updateProfile(authorization, request);
	}

	@Patch("/me/passkey-required")
	@Security("BearerAuth")
	setPasskeyRequired(@BodyParams() request: SetPasskeyRequiredRequest, @HeaderParams("authorization") authorization?: string) {
		return this.authService.setPasskeyRequired(authorization, request.enabled, request.password);
	}

	@Post("/me/password")
	@Security("BearerAuth")
	changePassword(@BodyParams() request: ChangePasswordRequest, @HeaderParams("authorization") authorization?: string) {
		return this.authService.changePassword(authorization, request.currentPassword, request.newPassword);
	}

	@Post("/me/delete")
	@Security("BearerAuth")
	deleteMe(@BodyParams() request: DeleteAccountRequest, @HeaderParams("authorization") authorization?: string) {
		return this.authService.deleteAccount(authorization, request.password);
	}

	@Post("/verify-email")
	verifyEmail(@BodyParams() request: VerifyEmailRequest) {
		return this.authService.verifyEmail(request.token);
	}

	@Post("/resend-verification")
	resendVerification(@BodyParams() request: LoginRequest) {
		return this.authService.resendVerification(request.username, request.password);
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
