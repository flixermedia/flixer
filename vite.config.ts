import { builtinModules } from "node:module";
import { defineConfig } from "vite";

export default defineConfig({
	appType: "custom",
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
