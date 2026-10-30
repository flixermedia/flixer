import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enrichOpenApiResponses } from "./api-response-schemas.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "packages/flixer-api-client/openapi.json");
const source = process.env.OPENAPI_URL ?? "http://localhost:8083/api/scalar/doc/openapi.json";
const response = await fetch(source, { signal: AbortSignal.timeout(10_000) });

if (!response.ok) {
	throw new Error(`Could not fetch OpenAPI document from ${source}: HTTP ${response.status}`);
}

const specification = await response.json();
if (typeof specification !== "object" || specification === null || typeof specification.openapi !== "string" || typeof specification.paths !== "object") {
	throw new Error(`The response from ${source} is not an OpenAPI document.`);
}

enrichOpenApiResponses(specification);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(specification, null, 2)}\n`);
console.log(`Updated ${target} from ${source}`);
