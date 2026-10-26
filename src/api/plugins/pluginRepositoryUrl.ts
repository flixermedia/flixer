import { isIP } from "node:net";

export function normalizePluginRepositoryUrl(value: unknown): string {
	if (typeof value !== "string" || value.trim().length > 2048) {
		throw new Error("Repository URL must be text of at most 2048 characters.");
	}

	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("Repository URL must be a valid HTTPS URL ending in /repository.json.");
	}

	const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(url.port !== "" && url.port !== "443") ||
		isIP(hostname) !== 0 ||
		!hostname.includes(".") ||
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		!url.pathname.endsWith("/repository.json")
	) {
		throw new Error(
			"Repository URL must be an HTTPS URL ending in /repository.json without credentials or query parameters or an IP-literal host.",
		);
	}

	return url.toString();
}
