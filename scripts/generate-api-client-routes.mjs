import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = resolve(root, "packages/flixer-api-client/openapi.json");
const routesPath = resolve(root, "packages/flixer-api-client/src/routes.ts");
const specification = JSON.parse(await readFile(specPath, "utf8"));
const routes = [];

for (const [path, pathItem] of Object.entries(specification.paths ?? {})) {
	for (const [method, operation] of Object.entries(pathItem ?? {})) {
		if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) continue;
		if (!operation || typeof operation !== "object" || !("operationId" in operation) || typeof operation.operationId !== "string") continue;
		const pathParameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
		const hasQuery = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].some(
			(parameter) => parameter && typeof parameter === "object" && "in" in parameter && parameter.in === "query",
		);
		routes.push({
			method,
			path: path.replace(/^\/api(?=\/|$)/, ""),
			operationId: operation.operationId[0].toLowerCase() + operation.operationId.slice(1),
			pathParameters,
			hasBody: Boolean(operation.requestBody),
			hasQuery,
		});
	}
}

routes.sort((left, right) => left.pathParameters.length - right.pathParameters.length || right.path.length - left.path.length);
await mkdir(dirname(routesPath), { recursive: true });
await writeFile(routesPath, `export const routes = ${JSON.stringify(routes, null, 2)} as const;\n`);
console.log(`Generated ${routes.length} API routes in ${routesPath}`);
