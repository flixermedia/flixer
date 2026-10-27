import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Controller } from "@tsed/di";
import { Get, Post, Security } from "@tsed/schema";
import { DeleteAccountRequest } from "./deleteAccountRequest.js";
import { PasskeySecondFactorRequest } from "./passkeySecondFactorRequest.js";
import { PasskeyService } from "./passkeyService.js";
import { PasskeyVerifyRequest } from "./passkeyVerifyRequest.js";
import {
	NativePasskeyHandoffExchangeRequest,
	NativePasskeyHandoffIdRequest,
	NativePasskeyHandoffStartRequest,
	NativePasskeyHandoffVerifyRequest,
} from "./nativePasskeyHandoffRequests.js";

@Controller("/auth/passkeys")
export class PasskeyController {

	constructor(private readonly passkeyService: PasskeyService) {}

	@Get("/")
	@Security("BearerAuth")
	list(@HeaderParams("authorization") authorization?: string) {
		return this.passkeyService.listPasskeys(authorization);
	}

	@Post("/register/options")
	@Security("BearerAuth")
	registrationOptions(
		@BodyParams() request: DeleteAccountRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		return this.passkeyService.createRegistrationOptions(request.password, authorization);
	}

	@Post("/register/verify")
	@Security("BearerAuth")
	registrationVerify(
		@BodyParams() request: PasskeyVerifyRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		return this.passkeyService.verifyRegistration(request.response, request.name, authorization);
	}

	@Post("/login/options")
	loginOptions() {
		return this.passkeyService.createAuthenticationOptions();
	}

	@Post("/login/verify")
	loginVerify(@BodyParams() request: PasskeyVerifyRequest) {
		return this.passkeyService.verifyAuthentication(request.response);
	}

	@Post("/second-factor/options")
	secondFactorOptions(@BodyParams() request: PasskeySecondFactorRequest) {
		return this.passkeyService.createSecondFactorOptions(request.ticket);
	}

	@Post("/second-factor/verify")
	secondFactorVerify(@BodyParams() request: PasskeySecondFactorRequest) {
		return this.passkeyService.verifySecondFactor(request.ticket, request.response);
	}

	@Post("/native-handoff/start")
	startNativeHandoff(@BodyParams() request: NativePasskeyHandoffStartRequest) {
		return this.passkeyService.startNativeHandoff(request.codeChallenge, request.state, request.ticket);
	}

	@Post("/native-handoff/options")
	nativeHandoffOptions(@BodyParams() request: NativePasskeyHandoffIdRequest) {
		return this.passkeyService.createNativeHandoffOptions(request.handoffId);
	}

	@Post("/native-handoff/verify")
	verifyNativeHandoff(@BodyParams() request: NativePasskeyHandoffVerifyRequest) {
		return this.passkeyService.verifyNativeHandoff(request.handoffId, request.response);
	}

	@Post("/native-handoff/exchange")
	exchangeNativeHandoff(@BodyParams() request: NativePasskeyHandoffExchangeRequest) {
		return this.passkeyService.exchangeNativeHandoff(request.code, request.codeVerifier, request.state);
	}

	@Post("/:passkeyId/delete")
	@Security("BearerAuth")
	remove(
		@PathParams("passkeyId") passkeyId: string,
		@BodyParams() request: DeleteAccountRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		return this.passkeyService.deletePasskey(passkeyId, request.password, authorization);
	}
}
