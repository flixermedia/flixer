import * as ts from "typescript-compiler";
import { relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "src");
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");

if (!configPath) {
	throw new Error(`Could not find the TypeScript configuration under ${root}`);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
	throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
}

const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram({
	rootNames: parsedConfig.fileNames,
	options: parsedConfig.options,
});
const checker = program.getTypeChecker();
const methods = new Map();

for (const sourceFile of program.getSourceFiles()) {
	if (!sourceFile.fileName.startsWith(`${sourceRoot}${sep}`)) continue;

	const visit = (node) => {
		if (ts.isClassDeclaration(node) && node.name) {
			for (const member of node.members) {
				if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name) || !member.body) continue;
				const operationId = `${node.name.text[0].toLowerCase()}${node.name.text.slice(1)}${member.name.text[0].toUpperCase()}${member.name.text.slice(1)}`;
				methods.set(operationId, member);
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
}

function schemaName(type) {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	if (!symbol || symbol.name.startsWith("__") || ["object", "array", "promise"].includes(symbol.name.toLowerCase())) return undefined;
	const declaration = symbol.declarations?.find((item) => item.getSourceFile().fileName.startsWith(`${sourceRoot}${sep}`));
	if (!declaration) return undefined;
	const sourcePath = relative(sourceRoot, declaration.getSourceFile().fileName).replaceAll(sep, "_").replace(/\.ts$/, "");
	const safeName = `${sourcePath}_${symbol.name}`.replace(/[^A-Za-z0-9_.-]/g, "_");
	return { symbol, safeName };
}

function schemaForType(type, definitions, active = new Set()) {
	if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive)) return {};
	if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) return undefined;
	if (type.isStringLiteral()) return { type: "string", const: type.value };
	if (type.isNumberLiteral()) return { type: "number", const: type.value };
	if (type.flags & ts.TypeFlags.BooleanLiteral) {
		return { type: "boolean", const: (type.intrinsicName ?? "").includes("true") };
	}
	if (type.flags & ts.TypeFlags.StringLike) return { type: "string" };
	if (type.flags & ts.TypeFlags.NumberLike) return { type: "number" };
	if (type.flags & ts.TypeFlags.BooleanLike) return { type: "boolean" };
	if (type.flags & ts.TypeFlags.BigIntLike) return { type: "string" };
	if (type.flags & ts.TypeFlags.Null) return { type: "null" };

	if (type.isUnion()) {
		const schemas = type.types.map((member) => schemaForType(member, definitions, active)).filter(Boolean);
		if (schemas.length === 0) return undefined;
		return schemas.length === 1 ? schemas[0] : { anyOf: schemas };
	}
	if (type.isIntersection()) {
		const schemas = type.types.map((member) => schemaForType(member, definitions, active)).filter(Boolean);
		return schemas.length === 0 ? undefined : schemas.length === 1 ? schemas[0] : { allOf: schemas };
	}

	if (checker.isArrayType(type) || checker.isTupleType(type)) {
		const elements = checker.getTypeArguments(type);
		return {
			type: "array",
			items: schemaForType(elements[0] ?? checker.getAnyType(), definitions, active) ?? {},
		};
	}

	const symbol = type.aliasSymbol ?? type.getSymbol();
	if (symbol?.name === "Date") return { type: "string", format: "date-time" };
	if (symbol?.name === "Buffer" || symbol?.name === "Uint8Array") return { type: "string", format: "binary" };

	const named = schemaName(type);
	if (named) {
		if (active.has(named.safeName)) return { $ref: `#/components/schemas/${named.safeName}` };
		if (!definitions[named.safeName]) {
			const nextActive = new Set(active);
			nextActive.add(named.safeName);
			definitions[named.safeName] = schemaForObject(type, definitions, nextActive);
		}
		return { $ref: `#/components/schemas/${named.safeName}` };
	}

	return schemaForObject(type, definitions, active);
}

function schemaForObject(type, definitions, active) {
	const properties = {};
	const required = [];

	for (const property of checker.getPropertiesOfType(type)) {
		if (property.flags & ts.SymbolFlags.Method) continue;
		const declaration = property.valueDeclaration ?? property.declarations?.[0];
		if (!declaration) continue;
		const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
		properties[property.name] = schemaForType(propertyType, definitions, active) ?? {};
		if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.name);
	}

	const schema = { type: "object" };
	if (Object.keys(properties).length > 0) schema.properties = properties;
	if (required.length > 0) schema.required = required;
	const indexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
	if (indexType) schema.additionalProperties = schemaForType(indexType, definitions, active) ?? {};
	return schema;
}

function returnSchema(method, definitions) {
	const signature = checker.getSignatureFromDeclaration(method);
	if (!signature) return undefined;
	const returnType = checker.getReturnTypeOfSignature(signature);
	const awaitedType = checker.getAwaitedType(returnType) ?? returnType;
	return schemaForType(awaitedType, definitions);
}

export function enrichOpenApiResponses(specification) {
	const definitions = specification.components?.schemas ?? {};
	let enriched = 0;
	let missing = 0;

	for (const pathItem of Object.values(specification.paths ?? {})) {
		for (const operation of Object.values(pathItem ?? {})) {
			if (!operation || typeof operation !== "object" || typeof operation.operationId !== "string") continue;
			const method = methods.get(operation.operationId);
			if (!method) {
				missing++;
				continue;
			}

			const schema = returnSchema(method, definitions);
			if (!schema) continue;

			for (const [status, response] of Object.entries(operation.responses ?? {})) {
				if (!/^2\d\d$/.test(status) || status === "204") continue;
				const existingSchema = Object.values(response.content ?? {}).some((mediaType) => mediaType.schema && Object.keys(mediaType.schema).length > 0);
				if (existingSchema) continue;
				const content = response.content ?? {};
				const mediaType = Object.keys(content)[0] ?? "application/json";
				response.content = {
					...content,
					[mediaType]: { ...content[mediaType], schema },
				};
				enriched++;
			}
		}
	}

	specification.components = { ...specification.components, schemas: definitions };
	console.log(`Inferred response schemas for ${enriched} operations; ${missing} OpenAPI operations had no matching controller method.`);
	return specification;
}
