import { withOptions } from "@tsed/config";
import { DotEnvsConfigSource } from "@tsed/config/dotenv";
import { JsonConfigSource } from "@tsed/config/json";
import { YamlConfigSource } from "@tsed/config/yaml";
import { existsSync, readFileSync } from "node:fs";
import loggerConfig from "./logger/index.js";

const pkg = JSON.parse(readFileSync("./package.json", { encoding: "utf8" }));
export const version: string = pkg.version;

const configSources = [withOptions(DotEnvsConfigSource, { silent: true }), ...(existsSync("./config.json") ? [withOptions(JsonConfigSource, { path: "./config.json" })] : []), ...(existsSync("./config.yaml") ? [withOptions(YamlConfigSource, { path: "./config.yaml" })] : [])];

/**
 * This is the shared configuration for the application
 */
export const config: Partial<TsED.Configuration> = {
	version,
	ajv: {
		returnsCoercedValues: true,
	},
	logger: loggerConfig,
	extends: configSources,
};
