import { Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { dataPath } from "../../config/dataPath.js";
import { headerSafe } from "./mailAddress.js";

const RESOURCE_DIRECTORY = path.resolve(process.cwd(), "resources", "emails");
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PLACEHOLDER = /{{\s*(\w+)\s*}}/g;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;

export interface BuiltinTemplate {
	label: string;
	description: string;
	subject: string;
	text: string;
	variables: Record<string, string>;
}

/** Templates shipped with Flixer. Their HTML lives in resources/emails; edits are saved under DATA_DIR/emails. */
export const BUILTIN_TEMPLATES: Record<string, BuiltinTemplate> = {
	"verify-email": {
		label: "Verify email address",
		description: "Sent when someone registers or changes their email address.",
		subject: "Verify your Flixer email",
		text: "Welcome, {{displayName}}.\n\nConfirm your email address to finish setting up your Flixer account (link expires in {{expiresIn}}):\n{{verifyUrl}}\n\nDidn't create a Flixer account? You can safely ignore this email.",
		variables: { displayName: "Alex", verifyUrl: "https://flixer.example.com/verify-email?token=example", expiresIn: "24 hours" },
	},
	"account-deleted": {
		label: "Account deleted",
		description: "Sent after a user's account has been permanently deleted.",
		subject: "Your Flixer account was deleted",
		text: "Goodbye, {{displayName}}.\n\nYour Flixer account \"{{username}}\" was permanently deleted on {{deletedAt}}. Your passkeys and sessions have been removed.\n\nDidn't delete your account? Contact your server administrator right away.",
		variables: { displayName: "Alex", username: "alex", deletedAt: "Mon, 01 Jan 2029 12:00:00 GMT", appUrl: "https://flixer.example.com" },
	},
};

interface StoredMeta {
	label?: string;
	description?: string;
	subject?: string;
}

export interface MailTemplate {
	name: string;
	label: string;
	description: string;
	subject: string;
	html: string;
	text: string;
	builtin: boolean;
	customized: boolean;
	variables: string[];
	updatedAt: Date | null;
}

export interface RenderedMail {
	subject: string;
	html: string;
	text: string;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function templateVariables(...sources: string[]): string[] {
	const found = new Set<string>();
	for (const source of sources) {
		for (const match of source.matchAll(PLACEHOLDER)) found.add(match[1]);
	}
	return [...found].sort();
}

export function fillTemplate(source: string, values: Record<string, string>, escape: (value: string) => string): string {
	return source.replace(PLACEHOLDER, (_match, key: string) => escape(values[key] ?? ""));
}

/** Reads, edits and renders email templates. Edited and new templates are stored in DATA_DIR/emails. */
@Injectable()
export class MailTemplateService {

	private get directory(): string {
		return dataPath("emails");
	}

	static isValidName(name: string): boolean {
		return NAME.test(name);
	}

	async list(): Promise<MailTemplate[]> {
		const names = new Set(Object.keys(BUILTIN_TEMPLATES));
		for (const file of await readdir(this.directory).catch(() => [] as string[])) {
			if (file.endsWith(".html") && NAME.test(file.slice(0, -5))) names.add(file.slice(0, -5));
		}
		const templates = await Promise.all([...names].map((name) => this.get(name)));
		return templates.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.label.localeCompare(b.label));
	}

	async get(name: string): Promise<MailTemplate> {
		this.assertName(name);
		const builtin = BUILTIN_TEMPLATES[name];
		const custom = await this.readCustom(name);
		if (!builtin && !custom) throw new NotFound("Template not found.");

		const html = custom?.html ?? (await readFile(path.join(RESOURCE_DIRECTORY, `${name}.html`), "utf8"));
		const meta = custom?.meta ?? {};
		const subject = meta.subject ?? builtin?.subject ?? "";
		const text = custom?.text ?? builtin?.text ?? "";
		return {
			name,
			label: meta.label ?? builtin?.label ?? name,
			description: meta.description ?? builtin?.description ?? "",
			subject,
			html,
			text,
			builtin: Boolean(builtin),
			customized: Boolean(custom),
			variables: [...new Set([...Object.keys(builtin?.variables ?? {}), ...templateVariables(html, subject, text)])].sort(),
			updatedAt: custom?.updatedAt ?? null,
		};
	}

	async save(name: string, input: { label?: string; description?: string; subject: string; html: string; text: string }): Promise<MailTemplate> {
		this.assertName(name);
		const subject = headerSafe(input.subject ?? "", 200);
		const label = headerSafe(input.label ?? "", 100) || BUILTIN_TEMPLATES[name]?.label || name;
		const description = headerSafe(input.description ?? "", 300);
		if (!subject) throw new BadRequest("A subject is required.");
		if (typeof input.html !== "string" || !input.html.trim()) throw new BadRequest("The HTML body is required.");
		if (typeof input.text !== "string") throw new BadRequest("The plain-text body must be text.");
		if (Buffer.byteLength(input.html) > MAX_HTML_BYTES) throw new BadRequest("The HTML body is too large (256 KB maximum).");
		if (Buffer.byteLength(input.text) > MAX_TEXT_BYTES) throw new BadRequest("The plain-text body is too large (64 KB maximum).");

		await mkdir(this.directory, { recursive: true });
		await this.writeAtomic(`${name}.html`, input.html);
		await this.writeAtomic(`${name}.txt`, input.text);
		await this.writeAtomic(`${name}.json`, JSON.stringify({ label, description, subject } satisfies StoredMeta, null, 2));
		return this.get(name);
	}

	/** Deletes a custom template, or restores a built-in one to its shipped version. */
	async remove(name: string): Promise<void> {
		this.assertName(name);
		if (!BUILTIN_TEMPLATES[name] && !(await this.readCustom(name))) throw new NotFound("Template not found.");
		await Promise.all(["html", "txt", "json"].map((extension) => rm(path.join(this.directory, `${name}.${extension}`), { force: true })));
	}

	async render(name: string, values: Record<string, string>): Promise<RenderedMail> {
		return this.renderTemplate(await this.get(name), values);
	}

	renderTemplate(template: Pick<MailTemplate, "subject" | "html" | "text">, values: Record<string, string>): RenderedMail {
		return {
			subject: headerSafe(fillTemplate(template.subject, values, (value) => value), 200),
			html: fillTemplate(template.html, values, escapeHtml),
			text: fillTemplate(template.text, values, (value) => value),
		};
	}

	sampleValues(name: string, variables: string[]): Record<string, string> {
		const known = BUILTIN_TEMPLATES[name]?.variables ?? {};
		return Object.fromEntries(variables.map((variable) => [variable, known[variable] ?? `[${variable}]`]));
	}

	private assertName(name: string): void {
		if (!NAME.test(name)) throw new BadRequest("Template names use lowercase letters, numbers and hyphens (max 64 characters).");
	}

	private async readCustom(name: string): Promise<{ html: string; text: string; meta: StoredMeta; updatedAt: Date } | null> {
		const htmlPath = path.join(this.directory, `${name}.html`);
		try {
			const [html, info] = await Promise.all([readFile(htmlPath, "utf8"), stat(htmlPath)]);
			const text = await readFile(path.join(this.directory, `${name}.txt`), "utf8").catch(() => "");
			const meta = JSON.parse(await readFile(path.join(this.directory, `${name}.json`), "utf8").catch(() => "{}")) as StoredMeta;
			return { html, text, meta, updatedAt: info.mtime };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	}

	private async writeAtomic(file: string, content: string): Promise<void> {
		const target = path.join(this.directory, file);
		const temporary = `${target}.${randomBytes(4).toString("hex")}.tmp`;
		await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
		await rename(temporary, target);
	}
}
