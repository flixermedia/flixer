import { version } from "./config.js";

/** Reports a development checkout separately from a published release. */
export function runtimeVersion(): string {
	return process.env.FLIXER_DEVELOPMENT_BUILD === "true" ? `${version}-dev` : version;
}
