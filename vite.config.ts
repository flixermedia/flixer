import { builtinModules } from "node:module";
import { defineConfig } from "vitest/config";

export default defineConfig({
	appType: "custom",
	server: {
		watch: {
			ignored: ["**/data/**", "**/*.db", "**/*.db-shm", "**/*.db-wal"],
		},
	},
	test: {
		// Only unit specs; the .mjs suites use node:test and run via `npm run test:node`.
		include: ["src/**/*.spec.ts"],
		// Specs import large Ts.ED module graphs; the default 5s is too tight when files run in parallel.
		testTimeout: 20_000,
		hookTimeout: 20_000,
		coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/**/*.spec.ts", "src/migrations/**"] },
	},
	build: {
		outDir: "dist",
		target: "node24",
		ssr: "src/index.ts",
		sourcemap: true,
		minify: false,
		rollupOptions: {
			// node:sqlite is only importable with the prefix, so builtinModules does not list it.
			external: [...builtinModules, ...builtinModules.map((module) => `node:${module}`), "node:sqlite"],
			output: {
				entryFileNames: "index.js",
				format: "es",
			},
		},
	},
});
