import { type LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";
import { normalizePluginRepositoryUrl } from "./pluginRepositoryUrl.js";
import { parsePluginRepositoryManifest, type PluginRepositoryManifest } from "./repositoryManifest.js";

const MAX_MANIFEST_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 5_000;

export function isPublicRepositoryAddress(value: string): boolean {
	try {
		return ipaddr.parse(value).range() === "unicast";
	} catch {
		return false;
	}
}

export function assertPublicRepositoryAddresses(addresses: readonly Pick<LookupAddress, "address">[]): void {
	if (addresses.length === 0) {
		throw new Error("Repository hostname did not resolve to a public network address.");
	}
	for (const resolved of addresses) {
		if (!resolved || typeof resolved.address !== "string" || !isPublicRepositoryAddress(resolved.address)) {
			throw new Error("Repository hostname resolves to a non-public network address.");
		}
	}
}

async function resolvePublicAddresses(hostname: string): Promise<LookupAddress[]> {
	const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
	assertPublicRepositoryAddresses(addresses);
	return addresses;
}

async function fetchPinnedBytes(url: URL, maxBytes: number, accept: string): Promise<Buffer> {
	const addresses = await resolvePublicAddresses(url.hostname);
	const selected = addresses[0];
	if (!selected || !isPublicRepositoryAddress(selected.address)) {
		throw new Error("Repository hostname did not resolve to a public network address.");
	}
	const pinnedLookup: InstanceType<typeof HttpsAgent>["options"]["lookup"] = (_hostname, options, callback) => {
		if (options.all) {
			callback(null, [selected]);
		} else {
			callback(null, selected.address, selected.family);
		}
	};
	const agent = new HttpsAgent({ keepAlive: false, lookup: pinnedLookup });

	try {
		return await new Promise<Buffer>((resolve, reject) => {
			const request = httpsRequest(
				url,
				{ agent, method: "GET", headers: { accept }, timeout: REQUEST_TIMEOUT_MS },
				(response) => {
					response.on("error", reject);
					if (response.statusCode !== 200) {
						response.resume();
						reject(
							new Error("Repository manifest request must return HTTP 200; redirects are not followed."),
						);
						return;
					}

					const contentLength = Number(response.headers["content-length"]);
					if (Number.isFinite(contentLength) && contentLength > MAX_MANIFEST_BYTES) {
						response.destroy(new Error(`Repository response exceeds the ${maxBytes} byte size limit.`));
						return;
					}

					const chunks: Buffer[] = [];
					let size = 0;
					response.on("data", (chunk: Buffer | string) => {
						const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
						size += data.length;
						if (size > MAX_MANIFEST_BYTES) {
							response.destroy(new Error(`Repository response exceeds the ${maxBytes} byte size limit.`));
							return;
						}
						chunks.push(data);
					});
					response.on("end", () => resolve(Buffer.concat(chunks)));
				},
			);

			request.on("timeout", () => request.destroy(new Error("Repository manifest request timed out.")));
			request.on("error", reject);
			request.end();
		});
	} finally {
		agent.destroy();
	}
}

export async function fetchPluginRepositoryManifest(value: string): Promise<PluginRepositoryManifest> {
	const normalizedUrl = normalizePluginRepositoryUrl(value);
	const response = await fetchPinnedBytes(new URL(normalizedUrl), MAX_MANIFEST_BYTES, "application/json");
	let json: unknown;
	try {
		json = JSON.parse(response.toString("utf8"));
	} catch {
		throw new Error("Repository response is not valid JSON.");
	}

	return parsePluginRepositoryManifest(json);
}

export async function fetchPluginRepositoryArtifact(
	repositoryUrl: string,
	artifactPath: string,
	maxBytes: number,
): Promise<Buffer> {
	if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9._/-]+$/.test(artifactPath)) {
		throw new Error("Repository artifact path is invalid.");
	}
	if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 104_857_600) {
		throw new Error("Repository artifact size limit is invalid.");
	}

	const normalizedUrl = normalizePluginRepositoryUrl(repositoryUrl);
	const baseUrl = new URL(".", normalizedUrl);
	const artifactUrl = new URL(artifactPath, baseUrl);
	if (artifactUrl.origin !== baseUrl.origin || !artifactUrl.pathname.startsWith(baseUrl.pathname)) {
		throw new Error("Repository artifact path escapes the repository root.");
	}

	return fetchPinnedBytes(artifactUrl, maxBytes, "application/octet-stream, application/json, application/gzip");
}
