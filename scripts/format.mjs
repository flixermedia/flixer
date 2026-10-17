import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import prettier from "prettier";
import babelPlugin from "prettier/plugins/babel";
import typescriptPlugin from "prettier/plugins/typescript";

const projectRoot = resolve(import.meta.dirname, "..");
const ignorePath = join(projectRoot, ".prettierignore");
const mode = process.argv[2];
const requestedFile = process.argv[3];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const skippedDirectories = new Set(["node_modules", ".git", ".vscode", "dist", "coverage"]);

if (mode !== "--write" && mode !== "--check" && mode !== "--write-file") {
	throw new Error("Usage: node scripts/format.mjs --write|--check|--write-file <path>");
}
if (mode === "--write-file" && !requestedFile) {
	throw new Error("A file path is required with --write-file.");
}

async function listFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const paths = await Promise.all(
		entries
			.filter((entry) => !(entry.isDirectory() && skippedDirectories.has(entry.name)))
			.map(async (entry) => {
				const path = join(directory, entry.name);
				return entry.isDirectory() ? listFiles(path) : [path];
			}),
	);
	return paths.flat();
}

async function inlineLeadingArrayStrings(source, filePath, options) {
	if (!sourceExtensions.has(extname(filePath))) {
		return source;
	}

	const isTypeScript = [".ts", ".tsx", ".mts", ".cts"].includes(extname(filePath));
	const parser = isTypeScript ? "typescript" : "babel";
	const pluginParser = isTypeScript ? typescriptPlugin.parsers.typescript : babelPlugin.parsers.babel;
	const parsed = await pluginParser.parse(source, { ...options, parser });
	const root = parsed.program ?? parsed;
	const rewrites = [];

	function visit(node) {
		if (node.type === "ArrayExpression" && node.elements.length > 1) {
			const leadingStrings = [];
			for (const element of node.elements) {
				if (element?.type === "Literal" && typeof element.value === "string") {
					leadingStrings.push(element);
					continue;
				}

				if (element?.type === "ObjectExpression" && leadingStrings.length > 0) {
					const arrayStart = node.range[0];
					const objectStart = element.range[0];
					const contents = leadingStrings.map(({ range }) => source.slice(range[0], range[1])).join(", ");
					rewrites.push({ start: arrayStart, end: objectStart + 1, text: `[${contents}, {` });
				}
				break;
			}
		}

		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				value.forEach((child) => {
					if (child && typeof child === "object" && typeof child.type === "string") {
						visit(child);
					}
				});
			} else if (value && typeof value === "object" && typeof value.type === "string") {
				visit(value);
			}
		}
	}

	visit(root);
	for (const { start, end, text } of rewrites.reverse()) {
		source = `${source.slice(0, start)}${text}${source.slice(end)}`;
	}
	return source;
}

async function compactScryptCalls(source, filePath, options) {
	if (!sourceExtensions.has(extname(filePath))) {
		return source;
	}

	const isTypeScript = [".ts", ".tsx", ".mts", ".cts"].includes(extname(filePath));
	const parser = isTypeScript ? "typescript" : "babel";
	const pluginParser = isTypeScript ? typescriptPlugin.parsers.typescript : babelPlugin.parsers.babel;
	const parsed = await pluginParser.parse(source, { ...options, parser });
	const root = parsed.program ?? parsed;
	const rewrites = [];

	function visit(node) {
		if (
			node.type === "CallExpression" &&
			node.callee?.type === "Identifier" &&
			node.callee.name === "scrypt" &&
			node.arguments.length === 5
		) {
			const callback = node.arguments[4];
			if (callback.type === "ArrowFunctionExpression" && callback.body?.type === "BlockStatement") {
				const callbackBody = source.slice(callback.body.range[0], callback.body.range[1]);
				const callIndent = source.slice(source.lastIndexOf("\n", node.range[0]) + 1, node.range[0]);
				const prefix = source.slice(node.callee.range[0], node.callee.range[1]);
				const args = node.arguments.slice(0, 4).map(({ range }) => source.slice(range[0], range[1]));
				const callbackHeader = source.slice(callback.range[0], callback.body.range[0]);
				const replacement = `${prefix}(${args.join(", ")}, ${callbackHeader}${callbackBody},\n${callIndent})`;
				rewrites.push({ start: node.range[0], end: node.range[1], text: replacement });
			}
		}

		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				value.forEach((child) => {
					if (child && typeof child === "object" && typeof child.type === "string") {
						visit(child);
					}
				});
			} else if (value && typeof value === "object" && typeof value.type === "string") {
				visit(value);
			}
		}
	}

	visit(root);
	for (const { start, end, text } of rewrites.sort((a, b) => b.start - a.start)) {
		source = `${source.slice(0, start)}${text}${source.slice(end)}`;
	}
	return source;
}

async function addNonReturnFunctionSpacing(source, filePath, options) {
	if (!sourceExtensions.has(extname(filePath))) {
		return source;
	}

	const isTypeScript = [".ts", ".tsx", ".mts", ".cts"].includes(extname(filePath));
	const parser = isTypeScript ? "typescript" : "babel";
	const pluginParser = isTypeScript ? typescriptPlugin.parsers.typescript : babelPlugin.parsers.babel;
	const parsed = await pluginParser.parse(source, { ...options, parser });
	const root = parsed.program ?? parsed;
	const insertions = [];
	function visit(node) {
		if (
			node.type === "FunctionDeclaration" &&
			node.body?.type === "BlockStatement" &&
			node.body.body.length > 0 &&
			!(node.body.body.length === 1 && node.body.body[0].type === "ReturnStatement")
		) {
			const openBrace = node.body.range?.[0];
			const closeBrace = node.body.range?.[1] - 1;
			if (typeof openBrace === "number" && source[openBrace] === "{") {
				const remainder = source.slice(openBrace + 1);
				if (!/^(?:\r\n|\n)[ \t]*(?:\r\n|\n)/.test(remainder)) {
					insertions.push(openBrace + 1);
				}
			}
			if (
				typeof closeBrace === "number" &&
				source[closeBrace] === "}" &&
				!/(?:\r\n|\n)[ \t]*(?:\r\n|\n)[ \t]*$/.test(source.slice(0, closeBrace))
			) {
				const closeLineStart = source.lastIndexOf("\n", closeBrace) + 1;
				insertions.push(closeLineStart > openBrace ? closeLineStart : closeBrace);
			}
		}

		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				value.forEach((child) => {
					if (child && typeof child === "object" && typeof child.type === "string") {
						visit(child);
					}
				});
			} else if (value && typeof value === "object" && typeof value.type === "string") {
				visit(value);
			}
		}
	}

	visit(root);
	for (const position of insertions.sort((a, b) => b - a)) {
		source = `${source.slice(0, position)}\n${source.slice(position)}`;
	}
	return source;
}

async function addClassBodySpacing(source, filePath, options) {
	if (!sourceExtensions.has(extname(filePath))) {
		return source;
	}

	const isTypeScript = [".ts", ".tsx", ".mts", ".cts"].includes(extname(filePath));
	const parser = isTypeScript ? "typescript" : "babel";
	const pluginParser = isTypeScript ? typescriptPlugin.parsers.typescript : babelPlugin.parsers.babel;
	const parsed = await pluginParser.parse(source, { ...options, parser });
	const root = parsed.program ?? parsed;
	const insertions = [];

	function visit(node) {
		if (node.type === "ClassDeclaration" && node.body?.type === "ClassBody" && node.body.body.length > 0) {
			const openBrace = node.body.range?.[0];
			if (typeof openBrace === "number" && source[openBrace] === "{") {
				const remainder = source.slice(openBrace + 1);
				if (!/^(?:\r\n|\n)[ \t]*(?:\r\n|\n)/.test(remainder)) {
					insertions.push(openBrace + 1);
				}
			}
		}

		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				value.forEach((child) => {
					if (child && typeof child === "object" && typeof child.type === "string") {
						visit(child);
					}
				});
			} else if (value && typeof value === "object" && typeof value.type === "string") {
				visit(value);
			}
		}
	}

	visit(root);
	for (const position of insertions.reverse()) {
		source = `${source.slice(0, position)}\n${source.slice(position)}`;
	}
	return source;
}

const files =
	mode === "--write-file"
		? [resolve(requestedFile)].filter((filePath) => {
				const relativePath = relative(projectRoot, filePath);
				if (
					!relativePath ||
					relativePath === ".." ||
					relativePath.startsWith(`..${sep}`) ||
					isAbsolute(relativePath)
				) {
					throw new Error(`File must be inside the project directory: ${filePath}`);
				}
				return true;
			})
		: (await listFiles(projectRoot)).sort();
const changedFiles = [];
const unformattedFiles = [];

for (const filePath of files) {
	const info = await prettier.getFileInfo(filePath, { ignorePath, withNodeModules: false });
	if (info.ignored || !info.inferredParser) {
		continue;
	}

	const original = await readFile(filePath, "utf8");
	const options = {
		...(await prettier.resolveConfig(filePath)),
		filepath: filePath,
	};
	const prettierFormatted = await prettier.format(original, options);
	const inlineArrays = await inlineLeadingArrayStrings(prettierFormatted, filePath, options);
	const compactedScryptCalls = await compactScryptCalls(inlineArrays, filePath, options);
	const functionSpacing = await addNonReturnFunctionSpacing(compactedScryptCalls, filePath, options);
	const expected = await addClassBodySpacing(functionSpacing, filePath, options);

	if (mode === "--check") {
		if (original !== expected) {
			unformattedFiles.push(relative(projectRoot, filePath));
		}
	} else if (original !== expected) {
		await writeFile(filePath, expected, "utf8");
		changedFiles.push(relative(projectRoot, filePath));
	}
}

if (unformattedFiles.length > 0) {
	console.error(`Files need formatting:\n${unformattedFiles.map((filePath) => `  ${filePath}`).join("\n")}`);
	process.exitCode = 1;
} else if (mode === "--check") {
	console.log("All matched files use Prettier style and function declaration spacing.");
} else {
	console.log(changedFiles.length ? `Formatted ${changedFiles.length} file(s).` : "All matched files are formatted.");
}
