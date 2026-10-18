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

const fastifyPlugins = ["@fastify/accepts", "@fastify/cookie", {
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
	imports: [DefaultDataSource, JobScheduler],
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
