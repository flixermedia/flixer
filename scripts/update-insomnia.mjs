import { createHash } from "node:crypto";
import { tryCatch } from "@dschz/try-catch";
import { faker } from "@faker-js/faker";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configuredCollectionPath = process.env.INSOMNIA_FILE ?? "insomnia/flixer-insomnia.json";
const collectionPath = isAbsolute(configuredCollectionPath)
	? configuredCollectionPath
	: resolve(projectRoot, configuredCollectionPath);
const userFilePath = resolve(projectRoot, "insomnia", "flixer-user.json");
const openApiUrl = process.env.OPENAPI_URL ?? "http://localhost:8083/scalar/doc/openapi.json";
const SERVER_START_TIMEOUT_MS = 120_000;
const SERVER_POLL_INTERVAL_MS = 1_000;
const OPENAPI_REQUEST_TIMEOUT_MS = 5_000;
const SERVER_SHUTDOWN_TIMEOUT_MS = 10_000;
const httpMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const requestDefaults = {
	isPrivate: false,
	settingStoreCookies: true,
	settingSendCookies: true,
	settingDisableRenderRequestBody: false,
	settingEncodeUrl: true,
	settingRebuildPath: true,
	settingFollowRedirects: "global",
};
const loginAfterResponseScript = [
	"const body = insomnia.response.json();",
	"if (",
	'  typeof body?.accessToken !== "string" || body.accessToken.length === 0 ||',
	'  typeof body.user?.id !== "string" || body.user.id.length === 0 ||',
	'  typeof body.session?.id !== "string" || body.session.id.length === 0',
	") {",
	'  console.warn("Login response is missing accessToken, user.id, or session.id; environment values were not changed.");',
	"} else {",
	'  insomnia.environment.set("access_token", body.accessToken);',
	'  insomnia.environment.set("user_id", body.user.id);',
	'  insomnia.environment.set("session_id", body.session.id);',
	"}",
].join("\n");
const logoutAfterResponseScript = [
	"const body = insomnia.response.json();",
	'if (body?.loggedOut === true && typeof body.id === "string" && body.id.length > 0) {',
	'  insomnia.environment.set("access_token", "");',
	'  insomnia.environment.set("session_id", "");',
	'  insomnia.environment.set("user_id", "");',
	'  console.log("Cleared the logged-out session from the active environment.");',
	"} else {",
	'  console.warn("Logout response did not confirm success; environment values were not changed.");',
	"}",
].join("\n");
const revokeSessionAfterResponseScript = [
	"const body = insomnia.response.json();",
	'if (body?.revoked === true && typeof body.id === "string" && body.id.length > 0 && body.id === insomnia.environment.get("session_id")) {',
	'  insomnia.environment.set("session_id", "");',
	'  console.log("The current session was revoked; cleared its local credentials.");',
	'} else if (body?.revoked !== true || typeof body.id !== "string" || body.id.length === 0) {',
	'  console.warn("Revoke response did not confirm success; environment values were not changed.");',
	"} else {",
	'  console.log("Another session was revoked; the current environment credentials were kept.");',
	"}",
].join("\n");

export function createDefaultCollection() {
	const timestamp = Date.now();

	return {
		_type: "export",
		__export_format: 4,
		__export_date: new Date(timestamp).toISOString(),
		__export_source: "insomnia.desktop.app",
		resources: [
			{
				_id: "wrk_flixer_api",
				parentId: null,
				modified: timestamp,
				created: timestamp,
				name: "Flixer API",
				description:
					"Requests for the Flixer API. Development environment variables are automatically generated from the OpenAPI spec.",
				scope: "collection",
				_type: "workspace",
			},
			{
				_id: "env_flixer_base",
				parentId: "wrk_flixer_api",
				modified: timestamp,
				created: timestamp,
				name: "Base Environment",
				data: {},
				dataPropertyOrder: null,
				color: null,
				isPrivate: false,
				metaSortKey: 1,
				_type: "environment",
			},
			{
				_id: "env_flixer_dev",
				parentId: "env_flixer_base",
				modified: timestamp,
				created: timestamp,
				name: "Development",
				data: {
					base_url: defaultEnvironmentValue("base_url"),
					test_username: defaultEnvironmentValue("test_username"),
					test_email: defaultEnvironmentValue("test_email"),
					test_password: defaultEnvironmentValue("test_password"),
					access_token: defaultEnvironmentValue("access_token"),
					user_id: defaultEnvironmentValue("user_id"),
					session_id: defaultEnvironmentValue("session_id"),
				},
				dataPropertyOrder: {
					"&": [
						"base_url",
						"test_username",
						"test_email",
						"test_password",
						"access_token",
						"user_id",
						"session_id",
					],
				},
				color: "#4B9E5F",
				isPrivate: false,
				metaSortKey: timestamp,
				_type: "environment",
			},
		],
	};
}

async function readCollectionOrCreate(filePath) {
	const [readError, contents] = await tryCatch(() => readFile(filePath, "utf8"));
	if (readError && (!("code" in readError) || readError.code !== "ENOENT")) {
		throw readError;
	}
	if (!readError) {
		const [parseError, collection] = tryCatch(() => JSON.parse(contents));
		if (parseError) {
			throw parseError;
		}
		return collection;
	}
	if (!("code" in readError) || readError.code !== "ENOENT") {
		throw readError;
	}

	const collection = createDefaultCollection();
	await mkdir(dirname(filePath), { recursive: true });
	const [writeError] = await tryCatch(() =>
		writeFile(filePath, `${JSON.stringify(collection, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
	);
	if (writeError && (!("code" in writeError) || writeError.code !== "EEXIST")) {
		throw writeError;
	}

	const [createdReadError, createdContents] = await tryCatch(() => readFile(filePath, "utf8"));
	if (createdReadError) {
		throw createdReadError;
	}
	const [parseError, createdCollection] = tryCatch(() => JSON.parse(createdContents));
	if (parseError) {
		throw parseError;
	}
	return createdCollection;
}

function getGeneratedUser(collection) {
	const environment = collection.resources.find(
		(resource) => resource._type === "environment" && resource.name === "Development",
	);
	const data = environment?.data ?? {};
	return {
		username:
			typeof data.test_username === "string" && data.test_username
				? data.test_username
				: defaultEnvironmentValue("test_username"),
		email:
			typeof data.test_email === "string" && data.test_email
				? data.test_email
				: defaultEnvironmentValue("test_email"),
		password:
			typeof data.test_password === "string" && data.test_password
				? data.test_password
				: defaultEnvironmentValue("test_password"),
	};
}

function parseGeneratedUser(contents, filePath) {
	const [parseError, user] = tryCatch(() => JSON.parse(contents));
	if (parseError) {
		throw new Error(`Could not parse generated user file ${filePath}: ${parseError.message}`);
	}
	if (
		!user ||
		typeof user !== "object" ||
		typeof user.username !== "string" ||
		user.username.length < 3 ||
		user.username.length > 64 ||
		typeof user.email !== "string" ||
		user.email.length === 0 ||
		typeof user.password !== "string" ||
		user.password.length < 8
	) {
		throw new Error(`Generated user file ${filePath} must contain username, email, and password strings.`);
	}
	return { username: user.username, email: user.email, password: user.password };
}

async function readOrCreateGeneratedUser(filePath, fallbackUser) {
	const [readError, contents] = await tryCatch(() => readFile(filePath, "utf8"));
	if (!readError) {
		return parseGeneratedUser(contents, filePath);
	}
	if (!("code" in readError) || readError.code !== "ENOENT") {
		throw readError;
	}

	await mkdir(dirname(filePath), { recursive: true });
	const [writeError] = await tryCatch(() =>
		writeFile(filePath, `${JSON.stringify(fallbackUser, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
	);
	if (writeError && (!("code" in writeError) || writeError.code !== "EEXIST")) {
		throw writeError;
	}

	const [createdReadError, createdContents] = await tryCatch(() => readFile(filePath, "utf8"));
	if (createdReadError) {
		throw createdReadError;
	}
	return parseGeneratedUser(createdContents, filePath);
}

function isLocalHttpUrl(value) {
	const url = new URL(value);
	return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function startProjectServer() {
	const barrelsEntrypoint = resolve(projectRoot, "node_modules", "@tsed", "barrels", "bin", "barrels.js");
	const barrelsResult = spawnSync(process.execPath, [barrelsEntrypoint], {
		cwd: projectRoot,
		encoding: "utf8",
		windowsHide: true,
		env: process.env,
	});
	if (barrelsResult.error || barrelsResult.status !== 0) {
		const output = [barrelsResult.stdout, barrelsResult.stderr].filter(Boolean).join("\n").trim();
		const cause = barrelsResult.error?.message ?? `barrels exited with code ${barrelsResult.status}`;
		throw new Error(
			`Could not generate Ts.ED barrels before starting the API: ${cause}${output ? `\n${output}` : ""}`,
		);
	}

	const tsedDevEntrypoint = resolve(projectRoot, "node_modules", "@tsed", "cli", "lib", "esm", "bin", "tsed-dev.js");
	let startupError;
	let startupFailure;
	let startupOutput = "";
	let hasExited = false;
	let resolveExit;
	const exitPromise = new Promise((resolveExitPromise) => {
		resolveExit = resolveExitPromise;
	});
	const port = new URL(openApiUrl).port || process.env.PORT || "8083";
	const env = { ...process.env, PORT: port, TSED_VITE_RUN_MODE: "app" };
	const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	env[pathKey] = `${resolve(projectRoot, "node_modules", ".bin")}${delimiter}${env[pathKey] ?? ""}`;
	const child = spawn(process.execPath, [tsedDevEntrypoint, "--no-watch"], {
		cwd: projectRoot,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
		env,
	});
	const captureOutput = (chunk) => {
		startupOutput = `${startupOutput}${chunk}`.slice(-12_000);
	};
	child.stdout?.setEncoding("utf8").on("data", captureOutput);
	child.stderr?.setEncoding("utf8").on("data", captureOutput);
	child.once("error", (error) => {
		startupError = error;
	});
	child.once("exit", (code, signal) => {
		hasExited = true;
		startupFailure = `Ts.ED dev server exited with ${signal ? `signal ${signal}` : `code ${code}`}`;
		resolveExit();
	});
	child.unref();

	return {
		get error() {
			return startupError ?? (startupFailure ? new Error(startupFailure) : undefined);
		},
		get output() {
			return startupOutput.trim();
		},
		detachOutput() {
			child.stdout?.unref();
			child.stderr?.unref();
		},
		async stop() {
			if (hasExited || !child.pid) {
				return;
			}

			const [killError] = tryCatch(() => {
				if (process.platform === "win32") {
					child.kill("SIGTERM");
				} else {
					process.kill(-child.pid, "SIGTERM");
				}
			});
			if (killError && (!("code" in killError) || killError.code !== "ESRCH")) {
				throw killError;
			}
			if (killError) {
				return;
			}

			let shutdownTimer;
			const exitedGracefully = await Promise.race([
				exitPromise.then(() => true),
				new Promise((resolveTimeout) => {
					shutdownTimer = setTimeout(() => resolveTimeout(false), SERVER_SHUTDOWN_TIMEOUT_MS);
				}),
			]);
			if (shutdownTimer) {
				clearTimeout(shutdownTimer);
			}

			if (!exitedGracefully && !hasExited) {
				child.kill("SIGKILL");
				await exitPromise;
			}
		},
	};
}

async function fetchOpenApiDocument() {
	const response = await fetch(openApiUrl, { signal: AbortSignal.timeout(OPENAPI_REQUEST_TIMEOUT_MS) });
	if (!response.ok) {
		throw new Error(`Could not fetch OpenAPI spec from ${openApiUrl}: HTTP ${response.status}`);
	}

	return response.json();
}

async function waitForOpenApi(startup) {
	const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
	let lastError;

	while (Date.now() < deadline) {
		if (startup.error) {
			throw new Error(`Could not start the project server: ${startup.error.message}`);
		}

		const [fetchError, document] = await tryCatch(() => fetchOpenApiDocument());
		if (!fetchError) {
			startup.detachOutput();
			return document;
		}
		lastError = fetchError;
		if (
			!(fetchError instanceof TypeError) &&
			!(fetchError instanceof DOMException && fetchError.name === "TimeoutError")
		) {
			throw fetchError;
		}

		await new Promise((resolveDelay) => setTimeout(resolveDelay, SERVER_POLL_INTERVAL_MS));
	}

	const cause = lastError instanceof Error ? ` Last connection error: ${lastError.message}` : "";
	const output = startup.output ? `\nServer startup output:\n${startup.output}` : "";
	throw new Error(
		`The project server did not provide OpenAPI within ${SERVER_START_TIMEOUT_MS / 1000} seconds.${cause}${output}`,
	);
}

function resolveSchema(schema, document, seen = new Set()) {
	if (!schema || typeof schema !== "object") {
		return {};
	}

	if (!schema.$ref) {
		return schema;
	}

	if (seen.has(schema.$ref)) {
		return {};
	}

	const referencedSchema = schema.$ref
		.slice(2)
		.split("/")
		.reduce((value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], document);

	return resolveSchema(referencedSchema, document, new Set([...seen, schema.$ref]));
}

function sampleForSchema(schema, document, propertyName = "") {
	const resolved = resolveSchema(schema, document);
	const combinedProperties = Object.assign(
		{},
		...(resolved.allOf ?? []).map((part) => resolveSchema(part, document).properties ?? {}),
		resolved.properties ?? {},
	);

	if (Object.keys(combinedProperties).length > 0 || resolved.type === "object") {
		return Object.fromEntries(
			Object.entries(combinedProperties)
				.filter(([, propertySchema]) => !propertySchema.readOnly)
				.map(([name, propertySchema]) => [name, sampleForSchema(propertySchema, document, name)]),
		);
	}

	if (resolved.enum?.length) {
		return resolved.enum[0];
	}

	if (resolved.example !== undefined) {
		return resolved.example;
	}

	if (resolved.default !== undefined) {
		return resolved.default;
	}

	switch (resolved.type) {
		case "array":
			return resolved.items ? [sampleForSchema(resolved.items, document, propertyName)] : [];
		case "boolean":
			return false;
		case "integer":
		case "number":
			return 1;
		case "string":
			if (resolved.format === "email" || /email/i.test(propertyName)) {
				return "{{ _.test_email }}";
			}
			if (/username/i.test(propertyName)) {
				return "{{ _.test_username }}";
			}
			if (/password/i.test(propertyName)) {
				return "{{ _.test_password }}";
			}
			if (resolved.format === "date-time") {
				return "2026-01-01T00:00:00Z";
			}
			return `example-${propertyName || "value"}`;
		default:
			return {};
	}
}

function addEnvironmentValue(environment, key, value) {
	environment.data ??= {};
	environment.data[key] ??= value;
	environment.dataPropertyOrder ??= { "&": [] };
	const order = environment.dataPropertyOrder["&"] ?? [];
	if (!order.includes(key)) {
		order.push(key);
		environment.dataPropertyOrder["&"] = order;
	}
}

function defaultEnvironmentValue(key) {
	if (key === "base_url") {
		return "http://localhost:8083";
	}
	if (/^(access_)?token$|secret|^session_id$|^user_id$/i.test(key)) {
		return "";
	}
	if (/^(is_|has_)?(active|enabled|verified|admin|private)$/i.test(key)) {
		return faker.datatype.boolean();
	}
	if (/(^|_)(age|limit|count|page|quantity|amount|price|rating)(_|$)/i.test(key)) {
		return faker.number.int({ min: 1, max: 100 });
	}
	if (/date|time|timestamp|_at$/i.test(key)) {
		return faker.date.recent({ days: 30 }).toISOString();
	}
	if (/url|website|uri/i.test(key)) {
		return faker.internet.url();
	}
	if (/email/i.test(key)) {
		return faker.internet.email().toLowerCase();
	}
	if (/username/i.test(key)) {
		const username = faker.internet
			.username()
			.replace(/[^a-zA-Z0-9_.-]/g, "_")
			.slice(0, 64);
		return username.length >= 3 ? username : `${username}${faker.string.alphanumeric(3)}`.slice(0, 64);
	}
	if (/password/i.test(key)) {
		return faker.internet.password({ length: 16 });
	}
	if (/(^|_)id$|uuid/i.test(key)) {
		return faker.string.uuid();
	}
	if (/path_?queueName/i.test(key)) {
		return "";
	}
	if (/company|organization/i.test(key)) {
		return faker.company.name();
	}
	if (/address|street/i.test(key)) {
		return faker.location.streetAddress();
	}
	if (/zip|postal/i.test(key)) {
		return faker.location.zipCode();
	}
	if (/first_?name/i.test(key)) {
		return faker.person.firstName();
	}
	if (/last_?name|surname/i.test(key)) {
		return faker.person.lastName();
	}
	if (/(full_?)?name/i.test(key)) {
		return faker.person.fullName();
	}
	if (/phone/i.test(key)) {
		return faker.phone.number();
	}
	if (/state|province/i.test(key)) {
		return faker.location.state();
	}
	if (/city/i.test(key)) {
		return faker.location.city();
	}
	if (/country/i.test(key)) {
		return faker.location.country();
	}
	return `example-${key.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`.slice(0, 64);
}

function ensureReferencedEnvironmentVariables(environment, requests) {
	const variablePattern = /\{\{\s*_\.(\w+)\s*\}\}/g;

	for (const request of requests) {
		const source = [
			request.url,
			request.body?.text,
			...request.headers.map(({ value }) => value),
			...request.parameters.map(({ value }) => value),
		]
			.filter(Boolean)
			.join("\n");

		for (const [, name] of source.matchAll(variablePattern)) {
			addEnvironmentValue(environment, name, defaultEnvironmentValue(name));
		}
	}
}

function getRequestGroup(path) {
	const apiPath = path.startsWith("/api/") ? path.slice("/api/".length) : path.replace(/^\/+/, "");
	const [segment] = apiPath.split("/");
	const name = segment ? segment[0].toUpperCase() + segment.slice(1) : "Other";
	const id = createHash("sha1").update(name.toLowerCase()).digest("hex").slice(0, 12);
	return {
		_id: `grp_flixer_api_${id}`,
		name,
		description: `${name} API requests`,
		_type: "request_group",
	};
}

function makeRequest(document, path, method, operation, environment, metaSortKey, parentId) {
	const parameters = [...(operation.parameters ?? [])];
	const requestPath = path.replace(/\{([^}]+)\}/g, (_, name) => {
		const parameter = parameters.find((item) => item.in === "path" && item.name === name);
		const key =
			path === "/api/users/{id}" && name === "id"
				? "user_id"
				: path === "/api/auth/sessions/{sessionId}" && name === "sessionId"
					? "session_id"
					: `path_${name}`;
		addEnvironmentValue(environment, key, parameter?.example ?? defaultEnvironmentValue(key));
		return `{{ _.${key} }}`;
	});
	const queryParameters = parameters
		.filter((parameter) => parameter.in === "query")
		.map((parameter) => {
			const key = `query_${parameter.name}`;
			const initialValue = parameter.example ?? parameter.schema?.example ?? defaultEnvironmentValue(key);
			addEnvironmentValue(environment, key, initialValue);
			return {
				name: parameter.name,
				value: `{{ _.${key} }}`,
				disabled: false,
			};
		});
	const jsonContent = operation.requestBody?.content?.["application/json"];
	const body = jsonContent
		? {
				mimeType: "application/json",
				text: JSON.stringify(sampleForSchema(jsonContent.schema, document), null, 2),
			}
		: {};
	const headers = jsonContent ? [{ name: "Content-Type", value: "application/json" }] : [];
	if (operation.security?.length) {
		headers.push({ name: "Authorization", value: "Bearer {{ _.access_token }}" });
	}
	let afterResponseScript;
	if (method.toLowerCase() === "post" && path === "/api/auth/login") {
		afterResponseScript = loginAfterResponseScript;
	} else if (method.toLowerCase() === "post" && path === "/api/auth/logout") {
		afterResponseScript = logoutAfterResponseScript;
	} else if (method.toLowerCase() === "delete" && path === "/api/auth/sessions/{sessionId}") {
		afterResponseScript = revokeSessionAfterResponseScript;
	}
	const scripts = afterResponseScript ? afterResponseScript : undefined;
	const id = createHash("sha1").update(`${method.toUpperCase()} ${path}`).digest("hex").slice(0, 12);
	const summary = operation.summary || `${method.toUpperCase()} ${path}`;
	const description = [operation.description, operation.tags?.length ? `Tags: ${operation.tags.join(", ")}` : ""]
		.filter(Boolean)
		.join("\n\n");

	return {
		_id: `req_flixer_${id}`,
		parentId,
		modified: Date.now(),
		created: Date.now(),
		url: `{{ _.base_url }}${requestPath}`,
		name: summary,
		description,
		method: method.toUpperCase(),
		body,
		parameters: queryParameters,
		headers,
		afterResponseScript: scripts,
		authentication: {},
		metaSortKey,
		...requestDefaults,
		_type: "request",
	};
}

export function updateCollection(collection, document, generatedUser = getGeneratedUser(collection)) {
	if (!document || typeof document.paths !== "object" || document.paths === null) {
		throw new Error("The OpenAPI document has no valid paths object.");
	}

	const workspace = collection.resources.find((resource) => resource._type === "workspace");
	if (!workspace) {
		throw new Error("The Insomnia export does not contain a workspace.");
	}

	const environment = collection.resources.find(
		(resource) => resource._type === "environment" && resource.parentId === "env_flixer_base",
	);
	if (!environment) {
		throw new Error("The Insomnia export does not contain the Development environment.");
	}
	environment.data ??= {};
	environment.data.test_username = generatedUser.username;
	environment.data.test_email = generatedUser.email;
	environment.data.test_password = generatedUser.password;
	environment.dataPropertyOrder ??= { "&": [] };
	for (const key of ["test_username", "test_email", "test_password"]) {
		const order = environment.dataPropertyOrder["&"] ?? [];
		if (!order.includes(key)) {
			order.push(key);
			environment.dataPropertyOrder["&"] = order;
		}
	}

	const requests = [];
	const groups = new Map();
	for (const [path, pathItem] of Object.entries(document.paths)) {
		if (!pathItem || typeof pathItem !== "object") {
			continue;
		}

		for (const [method, operation] of Object.entries(pathItem)) {
			if (!httpMethods.has(method.toLowerCase()) || !operation || typeof operation !== "object") {
				continue;
			}

			const inheritedParameters = pathItem.parameters ?? [];
			const effectiveOperation = {
				...operation,
				parameters: [...inheritedParameters, ...(operation.parameters ?? [])],
				security: operation.security ?? pathItem.security ?? document.security,
			};
			const group = getRequestGroup(path);
			groups.set(group._id, {
				...group,
				parentId: workspace._id,
				modified: Date.now(),
				created: Date.now(),
				metaSortKey: -groups.size,
				isPrivate: false,
			});
			requests.push(
				makeRequest(
					document,
					path,
					method,
					effectiveOperation,
					environment,
					-Date.now() + requests.length,
					group._id,
				),
			);
		}
	}

	if (requests.length === 0) {
		throw new Error("The OpenAPI document contains no HTTP operations; the collection was not changed.");
	}

	ensureReferencedEnvironmentVariables(environment, requests);
	const referencedVariables = new Set();
	for (const request of requests) {
		const source = [request.url, request.body?.text, ...request.headers.map(({ value }) => value)]
			.filter(Boolean)
			.join("\n");
		for (const [, name] of source.matchAll(/\{\{\s*_\.(\w+)\s*\}\}/g)) {
			referencedVariables.add(name);
		}
	}
	if (!referencedVariables.has("path_id")) {
		delete environment.data.path_id;
		environment.dataPropertyOrder["&"] = (environment.dataPropertyOrder["&"] ?? []).filter(
			(key) => key !== "path_id",
		);
	}
	collection.resources = collection.resources.filter(
		(resource) =>
			!(
				(resource._type === "request" && resource._id.startsWith("req_flixer_")) ||
				(resource._type === "request_group" && resource._id.startsWith("grp_flixer_api_"))
			),
	);
	collection.resources.push(...groups.values(), ...requests);
	collection.__export_date = new Date().toISOString();
	return collection;
}

async function main() {
	const collection = await readCollectionOrCreate(collectionPath);
	const generatedUser = await readOrCreateGeneratedUser(userFilePath, getGeneratedUser(collection));
	let startedServer;
	let operationError;
	[operationError] = await tryCatch(async () => {
		let document;
		const [fetchError, fetchedDocument] = await tryCatch(() => fetchOpenApiDocument());
		if (!fetchError) {
			document = fetchedDocument;
		} else {
			if (
				!(fetchError instanceof TypeError) &&
				!(fetchError instanceof DOMException && fetchError.name === "TimeoutError")
			) {
				throw fetchError;
			}
			if (!isLocalHttpUrl(openApiUrl)) {
				throw new Error(
					`Could not connect to ${openApiUrl}; automatic startup is only available for local HTTP URLs.`,
				);
			}

			console.log("OpenAPI endpoint is not reachable; starting the Ts.ED development server.");
			startedServer = startProjectServer();
			const [startupWaitError, startedDocument] = await tryCatch(() => waitForOpenApi(startedServer));
			if (startupWaitError) {
				const output = startedServer.output ? `\nServer startup output:\n${startedServer.output}` : "";
				const message = startupWaitError instanceof Error ? startupWaitError.message : String(startupWaitError);
				throw new Error(`${message}${output}`);
			}
			document = startedDocument;
		}

		const updatedCollection = updateCollection(collection, document, generatedUser);
		await mkdir(dirname(collectionPath), { recursive: true });
		await writeFile(collectionPath, `${JSON.stringify(updatedCollection, null, 2)}\n`, "utf8");
		const requestCount = updatedCollection.resources.filter((resource) => resource._type === "request").length;
		console.log(`Updated ${collectionPath} with ${requestCount} API requests from ${openApiUrl}.`);
	});

	if (startedServer) {
		startedServer.detachOutput();
		const [stopError] = await tryCatch(() => startedServer.stop());
		if (stopError) {
			if (operationError) {
				console.error("Failed to stop the project server after collection update failed.", stopError);
			} else {
				operationError = stopError;
			}
		} else {
			console.log("Stopped the project server started for this collection update.");
		}
	}

	if (operationError) {
		throw operationError;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [error] = await tryCatch(() => main());
	if (error) {
		console.error(`Insomnia collection update failed: ${error.message}`);
		process.exitCode = 1;
	}
}
