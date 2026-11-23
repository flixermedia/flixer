import { BodyParams, PathParams } from "@tsed/platform-params";
import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { Get, Post } from "@tsed/schema";
import { AcceptInvitationRequest, AcceptPlexInvitationRequest, LoginInvitationRequest, PlexInvitePollRequest, ResendInviteVerificationRequest } from "./inviteRequests.js";
import { InviteRedemptionService } from "./inviteRedemptionService.js";

const CODE_PATTERN = /^[a-zA-Z0-9-]{4,64}$/;

/** The public side of invitations: what an invite link shows and how it is redeemed. */
@Controller("/invites")
export class InvitesController {
	constructor(private readonly redemption: InviteRedemptionService) {}

	@Get("/:code")
	describe(@PathParams("code") code: string) {
		return this.redemption.describe(this.parseCode(code));
	}

	@Post("/:code/accept")
	accept(@PathParams("code") code: string, @BodyParams() request: AcceptInvitationRequest) {
		return this.redemption.redeem(this.parseCode(code), request);
	}

	@Post("/:code/login")
	login(@PathParams("code") code: string, @BodyParams() request: LoginInvitationRequest) {
		return this.redemption.resumeWithLogin(this.parseCode(code), request);
	}

	@Post("/:code/resend-verification")
	resendVerification(@PathParams("code") code: string, @BodyParams() request: ResendInviteVerificationRequest) {
		return this.redemption.resendVerification(this.parseCode(code), request.resendToken);
	}

	@Post("/:code/plex/start")
	startPlex(@PathParams("code") code: string) {
		return this.redemption.startPlexAuth(this.parseCode(code));
	}

	@Post("/:code/plex/poll")
	pollPlex(@PathParams("code") code: string, @BodyParams() request: PlexInvitePollRequest) {
		return this.redemption.pollPlexAuth(this.parseCode(code), request.sessionToken);
	}

	@Post("/:code/plex/accept")
	acceptPlex(@PathParams("code") code: string, @BodyParams() request: AcceptPlexInvitationRequest) {
		return this.redemption.redeemWithPlex(this.parseCode(code), request.plexAuthTicket);
	}

	private parseCode(code: string): string {
		if (!CODE_PATTERN.test(code)) {
			throw new NotFound("This invite does not exist or is no longer active.");
		}
		return code;
	}
}
