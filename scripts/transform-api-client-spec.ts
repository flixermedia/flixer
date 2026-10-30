import { defineTransformer } from "orval";

export default defineTransformer((specification) => {
	const paths = Object.fromEntries(
		Object.entries(specification.paths ?? {}).map(([path, pathItem]) => {
			if (!path.startsWith("/api/")) {
				throw new Error(`Expected Flixer API path to start with /api/: ${path}`);
			}

			return [path.slice(4), pathItem];
		}),
	);

	return { ...specification, paths };
});
