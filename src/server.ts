import "@tsed/ajv";
import "@tsed/platform-log-request";

import { Configuration, Inject } from "@tsed/di";
import { application } from "@tsed/platform-http";
import type { PlatformFastifyPluginSettings } from "@tsed/platform-fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { QueryRunner } from "typeorm";
import { join } from "node:path";

import "@tsed/platform-fastify";
import "@fastify/middie";
import "@tsed/platform-multer";
import "@tsed/scalar";
import * as api from "./api.js";
import { config } from "./config/config.js";
import { isTrustedProxy } from "./config/trustedProxies.js";
import { DefaultDataSource } from "./datasources/defaultDataSource.datasource.js";
import { AuthService } from "./api/auth/authService.js";
import { shouldBlockForMaintenance } from "./api/settings/maintenanceGuard.js";
import { applyRlsSession, runInRlsScope } from "./datasources/rlsContext.js";
import { JobScheduler } from "./jobs/jobScheduler.js";
import { LiveLogService } from "./logs/liveLogService.js";
import { LoggerExportService } from "./logs/loggerExportService.js";
import { LoggerControlSocket } from "./api/logger/loggerControlSocket.js";
import { LoggerLocalBootstrapService } from "./api/logger/loggerLocalBootstrapService.js";
import { LiveService } from "./live/liveService.js";
import { MailDeliveryService } from "./api/mail/mailDeliveryService.js";
import { MailInboundService } from "./api/mail/mailInboundService.js";
import { PartyGateway } from "./party/partyGateway.js";
import { ChatGateway } from "./chat/chatGateway.js";
import { NotificationGateway } from "./api/notifications/notificationGateway.js";
import { PlaybackRemoteService } from "./playbackRemote/playbackRemoteService.js";
import "./sentry/sentryErrorFilter.js";
import "./api/auth/login/loginExceptionFilter.js";
import { SentryService } from "./sentry/sentryService.js";
import { CORS_METHODS, CORS_ORIGINS } from "./cors.js";
import { OidcProviderService } from "./api/oidc/oidcProviderService.js";

const fastifyPlugins = [
	{
		use: "@fastify/cors",
		options: {
			origin: [...CORS_ORIGINS],
			methods: [...CORS_METHODS],
			successStatus: 200,
		},
	},
	"@fastify/accepts",
	"@fastify/cookie",
	{
		use: "fastify-raw-body",
		options: {
			global: false,
			runFirst: true,
		},
	},
	"@fastify/formbody",
] satisfies PlatformFastifyPluginSettings[];

@Configuration({
	...config,
	imports: [DefaultDataSource, JobScheduler, SentryService, LiveLogService, LoggerExportService, LoggerControlSocket, LoggerLocalBootstrapService, LiveService, MailDeliveryService, MailInboundService, PartyGateway, ChatGateway, NotificationGateway, PlaybackRemoteService],
	acceptMimes: ["application/json"],
	httpPort: process.env.PORT || 8083,
	httpsPort: false, // CHANGE
	fastify: {
		bodyLimit: 32 * 1024 * 1024,
		trustProxy: isTrustedProxy,
	},
	mount: {
		"/api": Object.values(api),
	},
	views: {
		root: join(process.cwd(), "../views"),
		extensions: {
			ejs: "ejs",
		},
	},
	scalar: [
		{
			path: "/api/scalar/doc",
			specVersion: "3.1.0",
			spec: {
				components: {
					securitySchemes: {
						BearerAuth: {
							type: "http",
							scheme: "bearer",
							bearerFormat: "JWT",
						},
						WebhookBasicAuth: {
							type: "http",
							scheme: "basic",
						},
					},
				},
			},
		},
	],
	plugins: fastifyPlugins,
})
export class Server {

	protected app = application();
	@Inject(OidcProviderService) private readonly oidc!: OidcProviderService;
	@Inject(DefaultDataSource) private readonly dataSource!: DefaultDataSource;
	@Inject(AuthService) private readonly authService!: AuthService;

	$beforeRoutesInit(): void {
		const fastify = this.app.getApp() as FastifyInstance;
		fastify.addHook("onRequest", async (request, reply) => {
			if (await shouldBlockForMaintenance(request.url, request.headers.authorization, this.dataSource, this.authService)) {
				reply.code(503).send({
					name: "MAINTENANCE",
					message: "Flixer is in maintenance mode. Please check back in a moment.",
					maintenance: true,
					status: 503,
				});
				return reply;
			}
		});

		const rlsQueryRunners = new WeakMap<FastifyRequest, { qr: QueryRunner; finished: boolean }>();
		const finishRls = async (request: FastifyRequest, commit: boolean): Promise<void> => {
			const entry = rlsQueryRunners.get(request);
			if (!entry || entry.finished) return;
			entry.finished = true;
			rlsQueryRunners.delete(request);
			try {
				if (entry.qr.isTransactionActive) {
					if (commit) await entry.qr.commitTransaction();
					else await entry.qr.rollbackTransaction();
				}
			} finally {
				await entry.qr.release();
			}
		};

		fastify.addHook("onRequest", (request, _reply, done) => {
			const path = request.url.split("?")[0] || "";
			const authorization = request.headers.authorization;
			if (!this.dataSource.isInitialized || !authorization || !path.startsWith("/api/") || path.startsWith("/api/auth/") || path.startsWith("/api/setup/") || path.startsWith("/api/oidc/")) {
				done();
				return;
			}
			void this.authService
				.getUserFromKeyOrSession(authorization)
				.then(async (user) => {
					const qr = this.dataSource.createQueryRunner();
					await qr.connect();
					await qr.startTransaction();
					try {
						await applyRlsSession(qr, { userId: user.id, role: user.role });
					} catch (error) {
						if (qr.isTransactionActive) await qr.rollbackTransaction().catch(() => {});
						await qr.release().catch(() => {});
						throw error;
					}
					rlsQueryRunners.set(request, { qr, finished: false });
					runInRlsScope(qr.manager, done);
				})
				.catch(() => {
					done();
				});
		});

		fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
			await finishRls(request, reply.statusCode < 500);
		});

		fastify.addHook("onError", async (request: FastifyRequest) => {
			await finishRls(request, false);
		});
		fastify.use("/.well-known/oauth-authorization-server/api/oidc", (request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void) => {
			if (request.url !== "/" && !request.url?.startsWith("/?")) return next();
			request.url = `/.well-known/oauth-authorization-server${request.url.slice(1)}`;
			void this.oidc
				.getProvider()
				.then((provider) => provider.callback()(request, response))
				.catch((error: unknown) => {
					next(error instanceof Error ? error : new Error(String(error)));
				});
		});
		fastify.use("/api/oidc", (request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void) => {
			if (/^\/interaction(?:\/|$)/.test(request.url || "")) {
				next();
				return;
			}
			void this.oidc
				.getProvider()
				.then((provider) => provider.callback()(request, response))
				.catch((error: unknown) => {
					next(error instanceof Error ? error : new Error(String(error)));
				});
		});
	}
}
