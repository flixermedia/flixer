import { Controller, Inject } from "@tsed/di";
import { BadRequest, Forbidden, NotFound } from "@tsed/exceptions";
import type { PlatformContext } from "@tsed/platform-http";
import { BodyParams, Context, HeaderParams, PathParams } from "@tsed/platform-params";
import { Enum, Get, Post, Property, Required, Security } from "@tsed/schema";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";
import { OidcProviderService } from "./oidcProviderService.js";

class OidcInteractionDecision {

	@Property()
	@Required()
	@Enum("login", "approve", "deny")
	action!: "login" | "approve" | "deny";
}

/** Bridges provider interactions to the authenticated Flixer interface. */
@Controller("/oidc/interaction")
export class OidcInteractionController {

	constructor(
		private readonly auth: AuthService,
		private readonly oidc: OidcProviderService,
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
	) {}

	@Get("/:uid")
	redirect(@PathParams("uid") uid: string, @Context() ctx: PlatformContext) {
		if (!/^[\w-]{1,128}$/.test(uid)) throw new NotFound("Interaction not found.");
		ctx.response.setHeader("Cache-Control", "no-store");
		ctx.response.redirect(302, `/oauth/interaction/${uid}`);
	}

	@Get("/:uid/details")
	@Security("BearerAuth")
	async details(@PathParams("uid") uid: string, @HeaderParams("authorization") authorization: string | undefined, @Context() ctx: PlatformContext) {
		const { user } = await this.auth.requireAuthenticatedSession(authorization);
		const provider = await this.oidc.getProvider();
		const interaction = await provider.interactionDetails(ctx.request.req, ctx.response.res);
		if (interaction.uid !== uid) throw new NotFound("Interaction not found.");
		if (interaction.prompt.name !== "login" && interaction.session && interaction.session.accountId !== user.id) throw new Forbidden("This request belongs to a different signed-in user. Start it again.");
		const clientId = interaction.params.client_id;
		if (typeof clientId !== "string") throw new BadRequest("Invalid client.");
		const client = await provider.Client.find(clientId);
		if (!client) throw new NotFound("OAuth client not found.");
		if (interaction.prompt.name !== "login" && interaction.prompt.name !== "consent") throw new BadRequest("Unsupported authorization request.");
		ctx.response.setHeader("Cache-Control", "no-store");
		return { prompt: interaction.prompt.name, clientName: client.clientName || clientId, scope: interaction.params.scope, username: user.username };
	}

	@Get("/:uid/client")
	async client(@PathParams("uid") uid: string, @Context() ctx: PlatformContext) {
		const provider = await this.oidc.getProvider();
		const interaction = await provider.interactionDetails(ctx.request.req, ctx.response.res);
		if (interaction.uid !== uid) throw new NotFound("Interaction not found.");
		const clientId = interaction.params.client_id;
		if (typeof clientId !== "string") throw new BadRequest("Invalid client.");
		const client = await provider.Client.find(clientId);
		if (!client) throw new NotFound("OAuth client not found.");
		ctx.response.setHeader("Cache-Control", "no-store");
		return { clientName: client.clientName || clientId };
	}

	@Post("/:uid")
	@Security("BearerAuth")
	async decide(@PathParams("uid") uid: string, @BodyParams() decision: OidcInteractionDecision, @HeaderParams("authorization") authorization: string | undefined, @Context() ctx: PlatformContext) {
		const { user } = await this.auth.requireAuthenticatedSession(authorization);
		const provider = await this.oidc.getProvider();
		const interaction = await provider.interactionDetails(ctx.request.req, ctx.response.res);
		if (interaction.uid !== uid) throw new NotFound("Interaction not found.");
		if (interaction.prompt.name !== "login" && interaction.session && interaction.session.accountId !== user.id) throw new Forbidden("This request belongs to a different signed-in user. Start it again.");
		let destination: string;
		if (decision.action === "deny") {
			destination = await provider.interactionResult(ctx.request.req, ctx.response.res, { error: "access_denied", error_description: "The user denied the request." }, { mergeWithLastSubmission: false });
		} else if (decision.action === "login" && interaction.prompt.name === "login") {
			destination = await provider.interactionResult(ctx.request.req, ctx.response.res, { login: { accountId: user.id, remember: false } }, { mergeWithLastSubmission: false });
		} else if (decision.action === "approve" && interaction.prompt.name === "consent") {
			const clientId = interaction.params.client_id;
			if (typeof clientId !== "string" || !interaction.session) throw new BadRequest("Invalid authorization request.");
			const grant = interaction.grantId ? await provider.Grant.find(interaction.grantId) : new provider.Grant({ accountId: user.id, clientId });
			if (!grant || grant.accountId !== user.id || grant.clientId !== clientId) throw new BadRequest("Invalid authorization grant.");
			const { missingOIDCScope, missingOIDCClaims } = interaction.prompt.details;
			if (Array.isArray(missingOIDCScope) && missingOIDCScope.every((item) => typeof item === "string")) grant.addOIDCScope(missingOIDCScope);
			if (Array.isArray(missingOIDCClaims) && missingOIDCClaims.every((item) => typeof item === "string")) grant.addOIDCClaims(missingOIDCClaims);
			const grantId = await grant.save();
			destination = await provider.interactionResult(ctx.request.req, ctx.response.res, { consent: { grantId } }, { mergeWithLastSubmission: true });
			await this.dataSource.query(
				`INSERT INTO "oidc_consents" ("account_id", "client_id", "scopes", "claims") VALUES ($1, $2, $3::text[], $4::text[])
				 ON CONFLICT ("account_id", "client_id") DO UPDATE SET
				 "scopes" = ARRAY(SELECT DISTINCT unnest("oidc_consents"."scopes" || EXCLUDED."scopes")),
				 "claims" = ARRAY(SELECT DISTINCT unnest("oidc_consents"."claims" || EXCLUDED."claims"))`,
				[user.id, clientId, grant.getOIDCScope().split(" ").filter(Boolean), grant.getOIDCClaims()],
			);
		} else {
			throw new BadRequest("This action does not match the authorization request.");
		}
		ctx.response.setHeader("Cache-Control", "no-store");
		return { redirect: destination };
	}
}
