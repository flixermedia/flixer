import { BadRequest } from "@tsed/exceptions";
import { sanitizeImage } from "./themeSchema.js";

const PAGE_BLOCK_TYPES = ["heading", "text", "image", "auth", "auth-field", "auth-custom", "auth-action", "button", "video", "card", "columns"] as const;
type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];
const AUTH_FIELDS = ["username", "password", "email", "displayName", "submit", "switch", "passkey", "quickConnect", "providers", "resend"] as const;
type AuthField = (typeof AUTH_FIELDS)[number];
interface PageBlockStyle { align?: "left" | "center" | "right"; color?: string; background?: string; spacing?: "compact" | "normal" | "spacious" }
interface PagePosition { x: number; y: number; width: number }
export interface PageBlock { id: string; type: PageBlockType; text: string; image: string | null; description?: string; href?: string; field?: AuthField; allowedFields?: string[]; style?: PageBlockStyle; columns?: PageBlock[][]; position?: { desktop: PagePosition; mobile: PagePosition } }
interface PageContent { blocks: PageBlock[]; layout?: "flow" | "free" }
type PageAccess = "public" | "signed-in";
export interface PublishedPage extends PageContent { title: string; slug: string; access?: PageAccess }
interface PageVersion { id: string; createdAt: string; content: PublishedPage }
interface ScheduledPage { at: string; content: PublishedPage }
export interface BuilderPage { id: string; title: string; slug: string; kind: "page" | "login"; draft: PageContent; access?: PageAccess; published: PublishedPage | null; history?: PageVersion[]; scheduled?: ScheduledPage | null }

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequest("Expected a page object.");
	return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, label: string): string {
	if (typeof value !== "string" || value.length > maximum) throw new BadRequest(`${label} is invalid.`);
	return value.trim();
}

function safeUrl(value: unknown): string {
	if (value === undefined || value === "") return "";
	const url = text(value, 2048, "Link");
	if (/^\/(?!\/)/.test(url) || /^#[a-zA-Z0-9_-]+$/.test(url)) return url;
	try {
		const parsed = new URL(url);
		if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) return parsed.href;
	} catch {}
	throw new BadRequest("Links must use HTTP, HTTPS, or a local path.");
}

function blockStyle(value: unknown): PageBlockStyle | undefined {
	if (value === undefined) return undefined;
	const source = object(value);
	const result: PageBlockStyle = {};
	if (source.align !== undefined) {
		if (!["left", "center", "right"].includes(String(source.align))) throw new BadRequest("Invalid alignment.");
		result.align = source.align as PageBlockStyle["align"];
	}
	for (const key of ["color", "background"] as const) {
		if (source[key] !== undefined && source[key] !== "") {
			if (typeof source[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(source[key])) throw new BadRequest("Invalid block color.");
			result[key] = source[key] as string;
		}
	}
	if (source.spacing !== undefined) {
		if (!["compact", "normal", "spacious"].includes(String(source.spacing))) throw new BadRequest("Invalid spacing.");
		result.spacing = source.spacing as PageBlockStyle["spacing"];
	}
	return result;
}

function position(value: unknown): PagePosition {
	const source = object(value);
	const { x, y, width } = source;
	if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || x < 0 || y < 0 || y > 5000 || width < 10 || width > 100 || x + width > 100) throw new BadRequest("Invalid block position.");
	return { x, y, width };
}

export function sanitizePageContent(value: unknown, kind: BuilderPage["kind"]): PageContent {
	const input = object(value);
	if (input.layout !== undefined && input.layout !== "flow" && input.layout !== "free") throw new BadRequest("Invalid page layout.");
	if (!Array.isArray(input.blocks) || input.blocks.length > 20) throw new BadRequest("A page can have at most 20 blocks.");
	const ids = new Set<string>();
	let count = 0;
	let imageBytes = 0;
	const parseBlock = (entry: unknown, depth: number): PageBlock => {
		if (++count > 50 || depth > 2) throw new BadRequest("The page has too many blocks or nested columns.");
		const block = object(entry);
		const id = text(block.id, 80, "Block id");
		if (!id || ids.has(id)) throw new BadRequest("Block ids must be unique.");
		ids.add(id);
		if (!PAGE_BLOCK_TYPES.includes(block.type as PageBlockType)) throw new BadRequest("Unknown page block.");
		const type = block.type as PageBlockType;
		if ((type === "auth" || type === "auth-field" || type === "auth-custom" || type === "auth-action") && depth !== 0) throw new BadRequest("Sign-in elements must be at the top level.");
		const image = type === "image" || type === "card" ? sanitizeImage(block.image, "Page image", { maxBytes: 256 * 1024, rasterOnly: true }) : null;
		imageBytes += image?.length ?? 0;
		const result: PageBlock = { id, type, text: type === "auth" || type === "columns" ? "" : text(block.text, type === "text" ? 4000 : 160, "Block text"), image };
		if (type === "auth-field") {
			if (!AUTH_FIELDS.includes(block.field as AuthField)) throw new BadRequest("Unknown sign-in element.");
			result.field = block.field as AuthField;
		}
		if (type === "auth-custom" && (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ["__proto__", "prototype", "constructor"].includes(id) || !result.text)) throw new BadRequest("Custom registration fields need a valid id and label.");
		if (type === "auth-action") {
			const href = text(block.href, 2048, "Action URL");
			if (!/^\/(?![\/\\])/.test(href) || href.includes("\\") || /[\u0000-\u0020]/.test(href)) throw new BadRequest("Custom actions must use a same-origin path.");
			if (!Array.isArray(block.allowedFields) || block.allowedFields.length > 10 || block.allowedFields.some((field) => typeof field !== "string")) throw new BadRequest("Invalid custom action field list.");
			result.href = href;
			result.allowedFields = [...new Set(block.allowedFields as string[])];
		}
		if (block.style !== undefined) result.style = blockStyle(block.style);
		if (block.position !== undefined) {
			const positions = object(block.position);
			result.position = { desktop: position(positions.desktop), mobile: position(positions.mobile) };
		}
		if (type === "button" || type === "video" || type === "card") result.href = safeUrl(block.href);
		if (type === "card") result.description = text(block.description ?? "", 2000, "Card description");
		if (type === "columns") {
			if (!Array.isArray(block.columns) || block.columns.length < 2 || block.columns.length > 3 || block.columns.some((column) => !Array.isArray(column))) throw new BadRequest("Columns must contain two or three lists of blocks.");
			result.columns = block.columns.map((column: unknown[]) => column.map((child) => parseBlock(child, depth + 1)));
		}
		return result;
	};
	const blocks = input.blocks.map((entry) => parseBlock(entry, 0));
	if (imageBytes > 1024 * 1024) throw new BadRequest("Page images are too large in total.");
	const authCount = blocks.filter((block) => block.type === "auth").length;
	const fields = blocks.filter((block) => block.type === "auth-field").map((block) => block.field);
	const customFields = blocks.filter((block) => block.type === "auth-custom");
	const actions = blocks.filter((block) => block.type === "auth-action");
	if (customFields.length > 10 || actions.length > 10) throw new BadRequest("Too many custom fields or actions.");
	if (actions.some((action) => action.allowedFields?.some((id) => !customFields.some((field) => field.id === id)))) throw new BadRequest("Actions can only send configured custom fields.");
	if (fields.length && input.layout !== "free") throw new BadRequest("Custom sign-in elements require a free-position layout.");
	if ((customFields.length || actions.length) && (!fields.length || input.layout !== "free")) throw new BadRequest("Custom registration elements require a custom sign-in form.");
	if (kind === "page" && (authCount || fields.length || customFields.length || actions.length)) throw new BadRequest("Sign-in elements are only allowed on the login page.");
	if (kind === "login" && !((authCount === 1 && fields.length === 0) || (authCount === 0 && fields.length === new Set(fields).size && ["username", "password", "email", "submit", "switch"].every((field) => fields.includes(field as AuthField))))) throw new BadRequest("Login pages must contain one sign-in form or all required sign-in elements.");
	return input.layout === undefined ? { blocks } : { blocks, layout: input.layout as "flow" | "free" };
}

export function sanitizePageDraft(value: unknown, kind: BuilderPage["kind"]): Pick<BuilderPage, "title" | "slug" | "draft" | "access"> {
	const input = object(value);
	const title = text(input.title, 80, "Page title");
	const slug = kind === "login" ? "login" : text(input.slug, 80, "Page address").toLowerCase();
	const access = input.access ?? "public";
	if (access !== "public" && access !== "signed-in") throw new BadRequest("Invalid page access.");
	if (kind === "login" && access !== "public") throw new BadRequest("The login page must be public.");
	if (!title) throw new BadRequest("A page title is required.");
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || (kind === "page" && slug === "login")) throw new BadRequest("Choose a valid page address.");
	return { title, slug, access, draft: sanitizePageContent(input.draft, kind) };
}