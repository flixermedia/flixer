#!/usr/bin/env node
import { CliCore } from "@tsed/cli-core";
import { tryCatch } from "@dschz/try-catch";
// import * as commands from "./bin/commands/index.js";
import { config } from "../config/config.js";

const [bootstrapError] = await tryCatch(() =>
	CliCore.bootstrap({
		...config,
		// commands: [...Object.values(commands)],
	}),
);

if (bootstrapError) {
	console.error(bootstrapError);
	process.exitCode = 1;
}
