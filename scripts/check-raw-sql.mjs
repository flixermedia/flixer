import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "src");
const CALL = /\b(?:dataSource|manager|runner|queryRunner|client|db)\.query(?:<[^>]*>)?\(/;
const LOOKBACK = 4;

async function files(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)])));
	return nested.flat();
}

const missing = [];
for (const file of await files(root)) {
	if (!file.endsWith(".ts") || file.endsWith(".spec.ts") || relative(root, file).startsWith("migrations")) continue;
	const lines = (await readFile(file, "utf8")).split("\n");
	lines.forEach((line, index) => {
		if (!CALL.test(line)) return;
		const above = lines.slice(Math.max(0, index - LOOKBACK), index + 1);
		if (!above.some((candidate) => candidate.includes("// RAW SQL:"))) missing.push(`${relative(resolve(root, ".."), file)}:${index + 1}`);
	});
}

if (missing.length > 0) {
	console.error(`Raw SQL calls need a "// RAW SQL: <reason>" comment above them:\n  ${missing.join("\n  ")}`);
	process.exit(1);
}
console.log("Every raw SQL call is annotated.");
