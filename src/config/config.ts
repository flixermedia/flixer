import { withOptions } from "@tsed/config";
import { DotEnvsConfigSource } from "@tsed/config/dotenv";
import { JsonConfigSource } from "@tsed/config/json";
import { YamlConfigSource } from "@tsed/config/yaml";
import { readFileSync } from "node:fs";
import loggerConfig from "./logger/index.js";

const pkg = JSON.parse(readFileSync("./package.json", { encoding: "utf8" }));
export const version: string = pkg.version;
/**
 * This is the shared configuration for the application
 */
export const config: Partial<TsED.Configuration> = {
	version,
	ajv: {
		returnsCoercedValues: true,
	},
	logger: loggerConfig,
	extends: [
		DotEnvsConfigSource,
		withOptions(JsonConfigSource, {
			path: "./config.json",
		}),
		withOptions(YamlConfigSource, {
			path: "./config.yaml",
		}),
	],
};
