import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "src");
const CALL = /\b(?:dataSource|manager|runner|queryRunner|client|db)\.query(?:<[\s\S]*?>)?\(/;
const LITERAL = /`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
const SQL = /\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/;
const LOOKBACK = 10;

async function files(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)])));
	return nested.flat();
}

const missing = [];
for (const file of await files(root)) {
	if (!file.endsWith(".ts") || file.endsWith(".spec.ts") || relative(root, file).startsWith("migrations")) continue;
	const text = await readFile(file, "utf8");
	const lines = text.split("\n");
	const lineOf = (offset) => text.slice(0, offset).split("\n").length - 1;
	const annotated = (line) => lines.slice(Math.max(0, line - LOOKBACK), line + 1).some((candidate) => candidate.includes("// RAW SQL:"));
	const flagged = new Set();
	lines.forEach((line, index) => {
		if (CALL.test(line) && !annotated(index)) flagged.add(index);
	});
	for (const match of text.matchAll(LITERAL)) {
		if (!SQL.test(match[0])) continue;
		const line = lineOf(match.index);
		if (!annotated(line)) flagged.add(line);
	}
	for (const line of [...flagged].sort((a, b) => a - b)) missing.push(`${relative(resolve(root, ".."), file)}:${line + 1}`);
}

if (missing.length > 0) {
	console.error(`Raw SQL needs a "// RAW SQL: <reason>" comment above it:\n  ${missing.join("\n  ")}`);
	process.exit(1);
}
console.log("Every raw SQL call is annotated.");
