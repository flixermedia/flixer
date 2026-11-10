import { BadRequest } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";

/**
 * Everything a Flixer theme can contain. A theme is plain data: colours, enums, numbers, short text and a few
 * images. `sanitizeThemeConfig` rebuilds the object from a whitelist, so unknown or hostile input never reaches
 * storage, the API or the web app, whether it came from the editor or from an imported theme file.
 */

export const PALETTE_KEYS = ["background", "surface", "border", "primary", "secondary", "accent", "highlight", "text", "muted", "ink"] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type ThemePalette = Record<PaletteKey, string>;

export const THEME_FONTS = ["system", "humanist", "geometric", "serif", "mono", "rounded"] as const;
export const CONTENT_WIDTHS = ["compact", "standard", "wide", "full"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const CARD_STYLES = ["outlined", "elevated", "flat", "glass"] as const;
export const HEADER_STYLES = ["floating", "bar", "transparent", "minimal"] as const;
export const HEADER_HEIGHTS = ["compact", "standard", "tall"] as const;
export const NAV_ALIGNMENTS = ["start", "center"] as const;
export const DEFAULT_MODES = ["dark", "light", "auto"] as const;
export const BUTTON_STYLES = ["solid", "gradient", "soft"] as const;

export interface ThemeConfig {
	defaultMode: (typeof DEFAULT_MODES)[number];
	colors: { dark: ThemePalette; light: ThemePalette };
	shape: { radius: number };
	typography: { font: (typeof THEME_FONTS)[number] };
	layout: {
		contentWidth: (typeof CONTENT_WIDTHS)[number];
		density: (typeof DENSITIES)[number];
		cardStyle: (typeof CARD_STYLES)[number];
		buttonStyle: (typeof BUTTON_STYLES)[number];
		/** Tint the accent colour from the artwork of the title being viewed. */
		artworkAccent: boolean;
	};
	header: {
		style: (typeof HEADER_STYLES)[number];
		height: (typeof HEADER_HEIGHTS)[number];
		navAlign: (typeof NAV_ALIGNMENTS)[number];
		showName: boolean;
	};
	branding: {
		appName: string | null;
		logo: string | null;
		logoLight: string | null;
		favicon: string | null;
		loginBackground: string | null;
	};
	customCss: string;
}

export const THEME_NAME_MAX = 60;
export const THEME_DESCRIPTION_MAX = 240;
export const APP_NAME_MAX = 40;
export const IMAGE_MAX_BYTES = 256 * 1024;
export const BACKGROUND_MAX_BYTES = 768 * 1024;
export const CUSTOM_CSS_MAX = 30_000;
export const RADIUS_MAX = 1.5;

const COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function plainObject(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new BadRequest(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function member<const T extends readonly string[]>(value: unknown, options: T, label: string): T[number] {
	if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
		throw new BadRequest(`${label} must be one of: ${options.join(", ")}.`);
	}
	return value;
}

function color(value: unknown, label: string): string {
	if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
		throw new BadRequest(`${label} must be a hex colour such as #7645d7.`);
	}
	const hex = value.toLowerCase();
	return hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}` : hex;
}

function palette(value: unknown, label: string): ThemePalette {
	const source = plainObject(value, label);
	const result = {} as ThemePalette;
	for (const key of PALETTE_KEYS) {
		result[key] = color(source[key], `${label}.${key}`);
	}
	return result;
}

/** Trims text and removes control characters and angle brackets, which have no place in a name or label. */
export function cleanText(value: unknown, label: string, max: number, required: boolean): string {
	if (typeof value !== "string") {
		if (required) {
			throw new BadRequest(`${label} is required.`);
		}
		return "";
	}
	// eslint-disable-next-line no-control-regex
	const text = value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
	if (required && text === "") {
		throw new BadRequest(`${label} is required.`);
	}
	if (text.length > max) {
		throw new BadRequest(`${label} can be at most ${max} characters.`);
	}
	return text;
}

const ICO_HEADER = (bytes: Buffer) => bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;

const IMAGE_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
	"image/png": (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
	"image/jpeg": (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
	"image/webp": (bytes) => bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP",
	"image/gif": (bytes) => ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("latin1")),
	"image/x-icon": ICO_HEADER,
	"image/vnd.microsoft.icon": ICO_HEADER,
};

const SVG_FORBIDDEN = /<\s*(script|foreignObject|iframe|object|embed|style|animate|set|use|image)\b|\son[a-z]+\s*=|javascript:|data:text|<!ENTITY|<!DOCTYPE|xlink:href|href\s*=|@import|url\s*\(/i;

/** Accepts only a base64 data URI of a real raster image (verified by its header bytes) or a script-free SVG. */
export function sanitizeImage(value: unknown, label: string, options: { maxBytes?: number; rasterOnly?: boolean } = {}): string | null {
	const maxBytes = options.maxBytes ?? IMAGE_MAX_BYTES;
	if (value === null || value === undefined || value === "") {
		return null;
	}
	if (typeof value !== "string") {
		throw new BadRequest(`${label} must be an image.`);
	}
	const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
	if (!match) {
		throw new BadRequest(`${label} must be an embedded PNG, JPEG, WebP, GIF, ICO or SVG image.`);
	}
	const [, mime, encoded] = match;
	const bytes = Buffer.from(encoded, "base64");
	if (bytes.length === 0 || bytes.length > maxBytes) {
		throw new BadRequest(`${label} must be smaller than ${maxBytes / 1024} KB.`);
	}
	if (options.rasterOnly && !/^image\/(png|jpeg|webp)$/.test(mime)) {
		throw new BadRequest(`${label} must be a PNG, JPEG or WebP image.`);
	}
	if (mime === "image/svg+xml") {
		const markup = bytes.toString("utf8");
		if (!/^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(markup) || SVG_FORBIDDEN.test(markup)) {
			throw new BadRequest(`${label} is an SVG that contains scripts or external references, which are not allowed.`);
		}
		return value;
	}
	const matches = IMAGE_SIGNATURES[mime];
	if (!matches || !matches(bytes)) {
		throw new BadRequest(`${label} is not a valid PNG, JPEG, WebP, GIF or ICO image.`);
	}
	return value;
}

const CSS_FORBIDDEN_AT_RULES = /@(import|charset|namespace|font-face|font-feature-values|document|-moz-document)\b/i;
const CSS_FORBIDDEN_FUNCTIONS = /(^|[^a-z0-9_-])(expression|src|image|image-set|-webkit-image-set|cross-fade|element|paint)\s*\(/i;
const CSS_FORBIDDEN_WORDS = /javascript:|vbscript:|data:text|-moz-binding|behavior\s*:|<\/?\s*style|<!--|-->|<\/?script/i;
const CSS_DATA_URL = /^url\(\s*(["']?)data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}\1\s*\)$/i;

/**
 * Custom CSS may restyle the app but can never load anything: no imports, fonts, remote images or script-like
 * constructs. Backslash escapes outside strings are refused so a forbidden word cannot be spelled around the checks.
 */
export function sanitizeCustomCss(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	if (typeof value !== "string") {
		throw new BadRequest("Custom CSS must be text.");
	}
	if (value.length > CUSTOM_CSS_MAX) {
		throw new BadRequest(`Custom CSS can be at most ${CUSTOM_CSS_MAX} characters.`);
	}
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
		throw new BadRequest("Custom CSS contains control characters.");
	}

	let code = "";
	let index = 0;
	while (index < value.length) {
		const char = value[index];
		if (char === "/" && value[index + 1] === "*") {
			const end = value.indexOf("*/", index + 2);
			if (end === -1) {
				throw new BadRequest("Custom CSS has an unterminated comment.");
			}
			index = end + 2;
			code += " ";
			continue;
		}
		if (char === '"' || char === "'") {
			let cursor = index + 1;
			for (; cursor < value.length && value[cursor] !== char; cursor++) {
				if (value[cursor] === "\\") {
					cursor++;
				} else if (value[cursor] === "\n") {
					throw new BadRequest("Custom CSS has an unterminated string.");
				}
			}
			if (cursor >= value.length) {
				throw new BadRequest("Custom CSS has an unterminated string.");
			}
			code += `${char}${char}`;
			index = cursor + 1;
			continue;
		}
		if (char === "\\") {
			throw new BadRequest("Custom CSS cannot use backslash escapes outside of strings.");
		}
		code += char;
		index++;
	}

	if (CSS_FORBIDDEN_AT_RULES.test(code)) {
		throw new BadRequest("Custom CSS cannot use @import, @font-face or similar at-rules that load resources.");
	}
	if (CSS_FORBIDDEN_FUNCTIONS.test(code) || CSS_FORBIDDEN_WORDS.test(code)) {
		throw new BadRequest("Custom CSS contains a function or keyword that is not allowed.");
	}
	for (const match of value.matchAll(/url\s*\(/gi)) {
		const rest = value.slice(match.index);
		const closing = rest.indexOf(")");
		const call = closing === -1 ? rest : rest.slice(0, closing + 1);
		if (!CSS_DATA_URL.test(call.replace(/^url\s*\(/i, "url("))) {
			throw new BadRequest("Custom CSS can only use url() with embedded PNG, JPEG, WebP or GIF images.");
		}
	}
	return value.replace(/\r\n?/g, "\n");
}

export function sanitizeThemeConfig(input: unknown): ThemeConfig {
	const source = plainObject(input, "Theme");
	const colors = plainObject(source.colors, "colors");
	const shape = plainObject(source.shape, "shape");
	const typography = plainObject(source.typography, "typography");
	const layout = plainObject(source.layout, "layout");
	const header = plainObject(source.header, "header");
	const branding = plainObject(source.branding ?? {}, "branding");

	const radius = shape.radius;
	if (typeof radius !== "number" || !Number.isFinite(radius) || radius < 0 || radius > RADIUS_MAX) {
		throw new BadRequest(`shape.radius must be a number between 0 and ${RADIUS_MAX}.`);
	}
	if (typeof header.showName !== "boolean") {
		throw new BadRequest("header.showName must be true or false.");
	}

	const appName = cleanText(branding.appName, "branding.appName", APP_NAME_MAX, false);

	return {
		defaultMode: member(source.defaultMode, DEFAULT_MODES, "defaultMode"),
		colors: { dark: palette(colors.dark, "colors.dark"), light: palette(colors.light, "colors.light") },
		shape: { radius: Math.round(radius * 100) / 100 },
		typography: { font: member(typography.font, THEME_FONTS, "typography.font") },
		layout: {
			contentWidth: member(layout.contentWidth, CONTENT_WIDTHS, "layout.contentWidth"),
			density: member(layout.density, DENSITIES, "layout.density"),
			cardStyle: member(layout.cardStyle, CARD_STYLES, "layout.cardStyle"),
			buttonStyle: member(layout.buttonStyle, BUTTON_STYLES, "layout.buttonStyle"),
			artworkAccent: layout.artworkAccent === true,
		},
		header: {
			style: member(header.style, HEADER_STYLES, "header.style"),
			height: member(header.height, HEADER_HEIGHTS, "header.height"),
			navAlign: member(header.navAlign, NAV_ALIGNMENTS, "header.navAlign"),
			showName: header.showName,
		},
		branding: {
			appName: appName === "" ? null : appName,
			logo: sanitizeImage(branding.logo, "Logo"),
			logoLight: sanitizeImage(branding.logoLight, "Light mode logo"),
			favicon: sanitizeImage(branding.favicon, "Favicon"),
			loginBackground: sanitizeImage(branding.loginBackground, "Login background", { maxBytes: BACKGROUND_MAX_BYTES, rasterOnly: true }),
		},
		customCss: sanitizeCustomCss(source.customCss),
	};
}

export const THEME_FILE_FORMAT = "flixer-theme";
export const THEME_FILE_VERSION = 1;
export const THEME_FILE_MAX_CHARS = 2_000_000;

export interface ThemeFile {
	format: typeof THEME_FILE_FORMAT;
	version: number;
	exportedAt: string;
	theme: { name: string; description: string; config: ThemeConfig };
}

/** Validates an imported theme file. The result contains only whitelisted, re-validated fields. */
export function parseThemeFile(raw: unknown): { name: string; description: string; config: ThemeConfig } {
	const file = plainObject(raw, "Theme file");
	if (file.format !== THEME_FILE_FORMAT) {
		throw new BadRequest("This is not a Flixer theme file.");
	}
	if (file.version !== THEME_FILE_VERSION) {
		throw new BadRequest("This theme file was made by a newer or unsupported version of Flixer.");
	}
	const theme = plainObject(file.theme, "theme");
	return {
		name: cleanText(theme.name, "Theme name", THEME_NAME_MAX, true),
		description: cleanText(theme.description, "Theme description", THEME_DESCRIPTION_MAX, false),
		config: sanitizeThemeConfig(theme.config),
	};
}

export interface ThemeSchedule {
	id: string;
	name: string;
	themeId: string;
	/** First day, as MM-DD. */
	start: string;
	/** Last day (inclusive), as MM-DD. An end before the start wraps over the new year. */
	end: string;
	enabled: boolean;
}

export const MAX_SCHEDULES = 24;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthDay(value: unknown, label: string): string {
	const match = typeof value === "string" ? /^(\d{2})-(\d{2})$/.exec(value) : null;
	const month = match ? Number(match[1]) : 0;
	const day = match ? Number(match[2]) : 0;
	if (!match || month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) {
		throw new BadRequest(`${label} must be a valid date written as MM-DD.`);
	}
	return value as string;
}

export function sanitizeSchedules(input: unknown): ThemeSchedule[] {
	if (!Array.isArray(input) || input.length > MAX_SCHEDULES) {
		throw new BadRequest(`Schedules must be a list of at most ${MAX_SCHEDULES} entries.`);
	}
	return input.map((entry, index) => {
		const item = plainObject(entry, `Schedule ${index + 1}`);
		if (typeof item.themeId !== "string" || !UUID.test(item.themeId)) {
			throw new BadRequest(`Schedule ${index + 1} must use an existing theme.`);
		}
		const id = typeof item.id === "string" && UUID.test(item.id) ? item.id : randomUUID();
		return {
			id,
			name: cleanText(item.name, "Schedule name", THEME_NAME_MAX, true),
			themeId: item.themeId,
			start: monthDay(item.start, "Start date"),
			end: monthDay(item.end, "End date"),
			enabled: item.enabled !== false,
		};
	});
}

/** The theme a schedule selects for the given day, or null when none applies. The first matching schedule wins. */
export function scheduledThemeId(schedules: readonly ThemeSchedule[], now: Date): string | null {
	const today = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	for (const schedule of schedules) {
		if (!schedule.enabled) {
			continue;
		}
		const inside = schedule.start <= schedule.end ? today >= schedule.start && today <= schedule.end : today >= schedule.start || today <= schedule.end;
		if (inside) {
			return schedule.themeId;
		}
	}
	return null;
}

/** Library id to accent colour. Only hex colours and uuids are accepted. */
export function sanitizeLibraryAccents(input: unknown): Record<string, string> {
	const source = plainObject(input, "Library accents");
	const entries = Object.entries(source);
	if (entries.length > 200) {
		throw new BadRequest("Too many library accents.");
	}
	const result: Record<string, string> = {};
	for (const [libraryId, color] of entries) {
		if (!UUID.test(libraryId)) {
			continue;
		}
		if (color === null || color === "") {
			continue;
		}
		if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) {
			throw new BadRequest("Library accent colours must be hex colours such as #7645d7.");
		}
		result[libraryId] = color.toLowerCase();
	}
	return result;
}
