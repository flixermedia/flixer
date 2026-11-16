import { BadRequest, Conflict } from "@tsed/exceptions";

export const ORGANIZATION_TEMPLATE_FIELDS = ["movie", "series", "episode", "music"] as const;
export type OrganizationTemplateField = (typeof ORGANIZATION_TEMPLATE_FIELDS)[number];
export type OrganizationTemplates = Record<OrganizationTemplateField, string>;

export const DEFAULT_ORGANIZATION_TEMPLATES: OrganizationTemplates = {
	movie: "{title} ({year})/{filename}",
	series: "{seriesTitle} ({seriesYear})",
	episode: "Season {season}/{filename}",
	music: "{artist}/{album} ({year})/{trackNumber} - {title}{extension}",
};

const TOKENS: Record<OrganizationTemplateField, readonly string[]> = {
	movie: ["title", "year", "filename"],
	series: ["seriesTitle", "seriesYear"],
	episode: ["season", "episode", "filename"],
	music: ["artist", "album", "year", "trackNumber", "title", "extension"],
};
const FILE_FIELDS: readonly OrganizationTemplateField[] = ["movie", "episode"];
const TOKEN_PATTERN = /\{([A-Za-z]+)\}/g;
const INVALID_NAME_CHARACTERS = /[<>:"|?*\\/\x00-\x1f]/g;
const INVALID_TEMPLATE_CHARACTERS = /[<>:"|?*\x00-\x1f]/;

export function validateOrganizationTemplates(value: unknown): OrganizationTemplates {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new BadRequest("Organization templates must be an object.");
	}
	const input = value as Record<string, unknown>;
	const result = {} as OrganizationTemplates;
	for (const field of ORGANIZATION_TEMPLATE_FIELDS) {
		const template = input[field];
		if (typeof template !== "string" || template.trim().length === 0 || template.length > 512 || template.includes("\\") || /[\0-\x1f]/.test(template)) {
			throw new BadRequest(`The ${field} template is invalid.`);
		}
		const tokens = [...template.matchAll(TOKEN_PATTERN)].map((match) => match[1]);
		const stripped = template.replace(TOKEN_PATTERN, "");
		if (stripped.includes("{") || stripped.includes("}")) {
			throw new BadRequest(`The ${field} template contains an invalid placeholder.`);
		}
		if (tokens.some((token) => !TOKENS[field].includes(token))) {
			throw new BadRequest(`The ${field} template contains an unsupported placeholder.`);
		}
		if (FILE_FIELDS.includes(field) && !tokens.includes("filename")) {
			throw new BadRequest(`The ${field} template must include {filename}.`);
		}
		if (field === "music" && !tokens.includes("filename") && !(tokens.includes("title") && tokens.includes("extension"))) {
			throw new BadRequest("The music template must include {filename}, or both {title} and {extension}.");
		}
		if (template.split("/").some((segment) => segment === "." || segment === ".." || segment.length === 0)) {
			throw new BadRequest(`The ${field} template contains an invalid path segment.`);
		}
		if (template.split("/").some((segment) => INVALID_TEMPLATE_CHARACTERS.test(segment.replace(TOKEN_PATTERN, "")))) {
			throw new BadRequest(`The ${field} template contains invalid filename characters.`);
		}
		result[field] = template.trim();
	}
	return result;
}

function safeSegment(value: string): string {
	const normalized = value
		.replace(INVALID_NAME_CHARACTERS, "_")
		.replace(/[. ]+$/g, "")
		.trim();
	return (normalized || "_").slice(0, 180);
}

export function renderOrganizationTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
	return template.replace(TOKEN_PATTERN, (_match, token: string) => {
		const value = values[token];
		return safeSegment(value === null || value === undefined || value === "" ? "Unknown" : String(value));
	});
}

export function rejectTargetCollisions(moves: readonly { rootId: string; sourceRelativePath: string; targetRelativePath: string }[]): void {
	const seen = new Map<string, (typeof moves)[number]>();
	for (const move of moves) {
		const key = `${move.rootId}/${move.targetRelativePath}`.normalize("NFC").toLocaleLowerCase("en-US");
		const previous = seen.get(key);
		if (previous) {
			throw new Conflict(`The plan contains multiple items with the same destination: "${previous.sourceRelativePath}" and "${move.sourceRelativePath}" both map to "${move.targetRelativePath}" (root ${move.rootId}).`);
		}
		seen.set(key, move);
	}
}
