import "@tsed/ajv";
import "@tsed/platform-log-request";

import { Configuration } from "@tsed/di";
import { application } from "@tsed/platform-http";
import type { PlatformFastifyPluginSettings } from "@tsed/platform-fastify";
import { join } from "node:path";

import "@tsed/platform-fastify";
import "@tsed/platform-multer";
import "@tsed/scalar";
import * as api from "./api.js";
import { config } from "./config/config.js";
import { DefaultDataSource } from "./datasources/defaultDataSource.datasource.js";
import { JobScheduler } from "./jobs/jobScheduler.js";
import { LiveLogService } from "./logs/liveLogService.js";
import { LiveService } from "./live/liveService.js";
import { PartyGateway } from "./party/partyGateway.js";
import { ChatGateway } from "./chat/chatGateway.js";
import "./sentry/sentryErrorFilter.js";
import { SentryService } from "./sentry/sentryService.js";
import { CORS_METHODS, CORS_ORIGINS } from "./cors.js";

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
	imports: [DefaultDataSource, JobScheduler, SentryService, LiveLogService, LiveService, PartyGateway, ChatGateway],
	acceptMimes: ["application/json"],
	httpPort: process.env.PORT || 8083,
	httpsPort: false, // CHANGE
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
			path: "/scalar/doc",
			specVersion: "3.1.0",
			spec: {
				components: {
					securitySchemes: {
						BearerAuth: {
							type: "http",
							scheme: "bearer",
							bearerFormat: "JWT",
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
}
