import { defineConfig } from "orval";

export default defineConfig({
	flixer: {
		input: {
			target: "./packages/flixer-api-client/openapi.json",
			override: {
				transformer: "./scripts/transform-api-client-spec.ts",
			},
		},
		output: {
			target: "./packages/flixer-api-client/src/generated.ts",
			client: "axios",
			mode: "single",
			schemas: false,
			clean: false,
		},
	},
});
