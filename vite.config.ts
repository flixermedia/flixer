import { builtinModules } from "node:module";

import { defineConfig } from "vite";

export default defineConfig({
	appType: "custom",
	server: {
		// Uploaded files (profile pictures) must not restart the dev server.
		watch: { ignored: ["**/data/**"] },
	},
	build: {
		outDir: "dist",
		target: "node24",
		ssr: "src/index.ts",
		sourcemap: true,
		minify: false,
		rollupOptions: {
			external: [...builtinModules, ...builtinModules.map((module) => `node:${module}`)],
			output: {
				entryFileNames: "index.js",
				format: "es",
			},
		},
	},
});
