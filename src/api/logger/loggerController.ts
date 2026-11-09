import { Controller } from "@tsed/di";
import { Context } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Security } from "@tsed/schema";
import { LoggerCapacityPolicyRequest, LoggerConfigurationRequest, LoggerIngestionPolicyRequest, LoggerOwnerConfigurationRequest, LoggerOwnerPairingRequest, LoggerPairingRequest, LoggerQuotaRequest, LoggerRetentionRequest } from "./loggerRequests.js";
import { LoggerService } from "./loggerService.js";
import { LoggerQueryProxy } from "./loggerQueryProxy.js";

@Controller("/admin/logger")
@Security("BearerAuth")
export class LoggerController {
	constructor(private readonly logger: LoggerService, private readonly queryProxy: LoggerQueryProxy) {}

	private async proxy(ctx: PlatformContext, kind: string, body: unknown, cursor?: string, authorization?: string) {
		const url = typeof ctx.request.url === "string" ? ctx.request.url : "";
		const index = url.indexOf("?");
		const query = index < 0 ? "" : url.slice(index);
		const controller = new AbortController();
		const cancel = () => controller.abort();
		ctx.response.res.once("close", cancel);
		try {
			if (ctx.response.res.destroyed) cancel();
			const result = await this.queryProxy.query(kind, query, body, cursor, authorization, controller.signal);
			ctx.response.setHeader("Content-Type", result.contentType);
			ctx.response.setHeader("Cache-Control", "private, no-store");
			ctx.response.setHeader("X-Accel-Buffering", "no");
			if (controller.signal.aborted) {
				result.abort();
				result.stream.destroy();
			}
			result.stream.once("close", () => ctx.response.res.off("close", cancel));
			return result.stream;
		} catch (error) {
			ctx.response.res.off("close", cancel);
			throw error;
		}
	}

	@Get("/data/:kind")
	query(@Context() ctx: PlatformContext, @PathParams("kind") kind: string,
		@HeaderParams("last-event-id") cursor?: string, @HeaderParams("authorization") authorization?: string) {
		return this.proxy(ctx, kind, undefined, cursor, authorization);
	}

	@Post("/data/search")
	search(@Context() ctx: PlatformContext, @BodyParams() body: Record<string, unknown>, @HeaderParams("authorization") authorization?: string) {
		return this.proxy(ctx, "search", body, undefined, authorization);
	}

	@Get("/configuration")
	configuration(@HeaderParams("authorization") authorization?: string) {
		return this.logger.configuration(authorization);
	}

	@Put("/configuration")
	configure(@BodyParams() request: LoggerConfigurationRequest, @HeaderParams("authorization") authorization?: string) {
		return this.logger.configure(request, authorization);
	}

	@Get("/pairing")
	pairingStatus(@HeaderParams("authorization") authorization?: string) {
		return this.logger.pairingStatus(authorization);
	}

	@Post("/pairing")
	pair(@BodyParams() request: LoggerPairingRequest, @HeaderParams("authorization") authorization?: string) {
		return this.logger.pair(request, authorization);
	}

	@Post("/pairing/retry")
	retryPairing(@HeaderParams("authorization") authorization?: string) {
		return this.logger.retryPairing(authorization);
	}

	@Delete("/pairing")
	discardPairing(@HeaderParams("authorization") authorization?: string) {
		return this.logger.discardPairing(authorization);
	}

	@Get("/retention")
	retention(@HeaderParams("authorization") authorization?: string) {
		return this.logger.getRetention(authorization);
	}

	@Get("/owner/configuration")
	ownerConfiguration(@HeaderParams("authorization") authorization?: string) {
		return this.logger.ownerConfiguration(authorization);
	}

	@Put("/owner/configuration")
	configureOwner(@BodyParams() request: LoggerOwnerConfigurationRequest, @HeaderParams("authorization") authorization?: string) {
		return this.logger.configureOwner(request, authorization);
	}

	@Get("/owner/capacity")
	ownerCapacity(@HeaderParams("authorization") authorization?: string) {
		return this.logger.ownerCapacity(authorization);
	}

	@Get("/owner/capacity-policy")
	capacityPolicy(@HeaderParams("authorization") authorization?: string) {
		return this.logger.getCapacityPolicy(authorization);
	}

	@Put("/owner/capacity-policy")
	setCapacityPolicy(@BodyParams() request: LoggerCapacityPolicyRequest, @HeaderParams("authorization") authorization?: string) {
		return this.logger.setCapacityPolicy(request, authorization);
	}

	@Get("/owner/pairings")
	ownerPairings(@QueryParams("deploymentId") deploymentId: string, @HeaderParams("authorization") authorization?: string) {
		return this.logger.listOwnerPairings(deploymentId, authorization);
	}

	@Post("/owner/pairings")
	createOwnerPairing(@Context() ctx: PlatformContext, @BodyParams() request: LoggerOwnerPairingRequest, @HeaderParams("authorization") authorization?: string) {
		ctx.response.setHeader("Cache-Control", "private, no-store");
		return this.logger.createOwnerPairing(request, authorization);
	}

	@Delete("/owner/pairings/:id")
	revokeOwnerPairing(@PathParams("id") id: string, @QueryParams("deploymentId") deploymentId: string, @HeaderParams("authorization") authorization?: string) {
		return this.logger.revokeOwnerPairing(deploymentId, id, authorization);
	}

	@Get("/owner/credentials")
	ownerCredentials(@QueryParams("deploymentId") deploymentId: string, @HeaderParams("authorization") authorization?: string) {
		return this.logger.listOwnerCredentials(deploymentId, authorization);
	}

	@Delete("/owner/credentials/:id")
	revokeOwnerCredential(@PathParams("id") id: string, @QueryParams("deploymentId") deploymentId: string, @HeaderParams("authorization") authorization?: string) {
		return this.logger.revokeOwnerCredential(deploymentId, id, authorization);
	}

	@Get("/health")
	health(@HeaderParams("authorization") authorization?: string) {
		return this.logger.health(authorization);
	}

	@Get("/status")
	status(@HeaderParams("authorization") authorization?: string) {
		return this.logger.status(authorization);
	}

	@Put("/retention")
	setRetention(@BodyParams() request: LoggerRetentionRequest, @HeaderParams("authorization") authorization?: string) {
		return this.logger.setRetention(request, authorization);
	}

	@Get("/ingestion-policy")
	ingestionPolicy(@HeaderParams("authorization") authorization?: string) {
		return this.logger.getIngestionPolicy(authorization);
	}

	@Put("/ingestion-policy")
	setIngestionPolicy(@BodyParams() request: LoggerIngestionPolicyRequest, @HeaderParams("authorization") authorization?: string) {
		return this.logger.setIngestionPolicy(request, authorization);
	}

	@Get("/quota")
	quota(@HeaderParams("authorization") authorization?: string) {
		return this.logger.getQuota(authorization);
	}

	@Put("/quota")
	setQuota(@BodyParams() request: LoggerQuotaRequest, @HeaderParams("authorization") authorization?: string) {
		return this.logger.setQuota(request, authorization);
	}

	@Post("/clear")
	clearLogs(@HeaderParams("authorization") authorization?: string) {
		return this.logger.clearLogs(authorization);
	}

	@Post("/query-token")
	queryToken(@Context() ctx: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		ctx.response.setHeader("Cache-Control", "private, no-store");
		return this.logger.issueQueryToken(authorization);
	}

	@Get("/credentials")
	credentials(@HeaderParams("authorization") authorization?: string) {
		return this.logger.listCredentials(authorization);
	}

	@Delete("/credentials/:id")
	revokeCredential(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.logger.revokeCredential(id, authorization);
	}
}
