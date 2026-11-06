import { Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { dataPath } from "../../config/dataPath.js";
import { appConfig } from "../../config/store/appConfig.js";
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
	"purchase-receipt": {
		label: "Purchase receipt",
		description: "Sent after a purchase, rental, subscription payment or signup payment.",
		subject: "Your Flixer receipt: {{title}}",
		text: "Thanks for your payment, {{displayName}}.\n\n{{kind}}: {{title}}\n{{detail}}\n\n{{lines}}\nTotal paid: {{total}}\n\nOrder {{orderId}} · {{date}}\n{{watchUrl}}",
		variables: {
			displayName: "Alex",
			kind: "Rental",
			title: "Blade Runner 2049",
			detail: "48 hours of access",
			posterUrl: "",
			lines: "Blade Runner 2049: £3.99",
			subtotal: "£3.99",
			discount: "",
			discountLabel: "Discount",
			tax: "£0.80",
			total: "£4.79",
			orderId: "a1b2c3d4",
			date: "Mon, 01 Jan 2029",
			watchUrl: "https://flixer.example.com",
			watchLabel: "Watch now",
		},
	},
	"account-deleted": {
		label: "Account deleted",
		description: "Sent after a user's account has been permanently deleted.",
		subject: "Your Flixer account was deleted",
		text: "Goodbye, {{displayName}}.\n\nYour Flixer account \"{{username}}\" was permanently deleted on {{deletedAt}}. Your passkeys and sessions have been removed.\n\nDidn't delete your account? Contact your server administrator right away.",
		variables: { displayName: "Alex", username: "alex", deletedAt: "Mon, 01 Jan 2029 12:00:00 GMT", appUrl: "https://flixer.example.com" },
	},
};

export interface TemplateKey {
	key: string;
	group: "global" | "account" | "payments";
	description: string;
	sample: string;
}

/** Every key a template can use. Global keys are filled automatically on every email; the rest come from the email that sends the template. */
export const TEMPLATE_KEYS: TemplateKey[] = [
	{ key: "appName", group: "global", description: "The name of this Flixer server.", sample: "Flixer" },
	{ key: "appUrl", group: "global", description: "The address people use to open Flixer.", sample: "https://flixer.example.com" },
	{ key: "year", group: "global", description: "The current year, handy for footers.", sample: "2029" },
	{ key: "displayName", group: "account", description: "The recipient's display name.", sample: "Alex" },
	{ key: "username", group: "account", description: "The recipient's username.", sample: "alex" },
	{ key: "verifyUrl", group: "account", description: "Email verification link (verify-email only).", sample: "https://flixer.example.com/verify-email?token=example" },
	{ key: "expiresIn", group: "account", description: "How long the verification link lasts (verify-email only).", sample: "24 hours" },
	{ key: "deletedAt", group: "account", description: "When the account was deleted (account-deleted only).", sample: "Mon, 01 Jan 2029 12:00:00 GMT" },
	{ key: "kind", group: "payments", description: "Purchase, Rental, Subscription or Account access.", sample: "Rental" },
	{ key: "title", group: "payments", description: "The title, product or plan that was paid for.", sample: "Blade Runner 2049" },
	{ key: "detail", group: "payments", description: "Rental length or renewal interval. Empty when there is nothing to add.", sample: "2 days of access" },
	{ key: "posterUrl", group: "payments", description: "Signed poster image link. Empty when the item has no poster.", sample: "" },
	{ key: "lines", group: "payments", description: "Plain-text line items, one per row.", sample: "Blade Runner 2049: £3.99" },
	{ key: "subtotal", group: "payments", description: "Price before discount and tax.", sample: "£3.99" },
	{ key: "discount", group: "payments", description: "Discount amount. Empty when no discount applied.", sample: "" },
	{ key: "discountLabel", group: "payments", description: "Discount row label, including the coupon code when one was used.", sample: "Discount" },
	{ key: "tax", group: "payments", description: "Tax amount. Empty when no tax was charged.", sample: "£0.80" },
	{ key: "total", group: "payments", description: "Total charged.", sample: "£4.79" },
	{ key: "orderId", group: "payments", description: "Short order reference.", sample: "A1B2C3D4" },
	{ key: "date", group: "payments", description: "Date of the payment.", sample: "Mon, 01 Jan 2029" },
	{ key: "watchUrl", group: "payments", description: "Link to the purchased title, or to Flixer.", sample: "https://flixer.example.com" },
	{ key: "watchLabel", group: "payments", description: "Button text for the watch link.", sample: "Watch now" },
];

/** Values every template can use without the sender providing them. */
function globalValues(): Record<string, string> {
	return {
		appName: appConfig().get("passkeyRpName") || "Flixer",
		appUrl: (appConfig().get("appUrl") || appConfig().get("publicUrl") || "").replace(/\/+$/, ""),
		year: String(new Date().getFullYear()),
	};
}

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
	keys: TemplateKey[];
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

const CONDITIONAL = /{{#if\s+(\w+)\s*}}([\s\S]*?){{\/if}}/g;

/** Fills {{placeholders}}; a {{#if name}}...{{/if}} block is kept only when that value is non-empty. */
export function fillTemplate(source: string, values: Record<string, string>, escape: (value: string) => string): string {
	return source.replace(CONDITIONAL, (_match, key: string, body: string) => (values[key] ? body : "")).replace(PLACEHOLDER, (_match, key: string) => escape(values[key] ?? ""));
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
		const variables = [...new Set([...Object.keys(builtin?.variables ?? {}), ...templateVariables(html, subject, text)])].sort();
		return {
			name,
			label: meta.label ?? builtin?.label ?? name,
			description: meta.description ?? builtin?.description ?? "",
			subject,
			html,
			text,
			builtin: Boolean(builtin),
			customized: Boolean(custom),
			variables,
			keys: TEMPLATE_KEYS,
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

	renderTemplate(template: Pick<MailTemplate, "subject" | "html" | "text">, provided: Record<string, string>): RenderedMail {
		const values = { ...globalValues(), ...provided };
		return {
			subject: headerSafe(fillTemplate(template.subject, values, (value) => value), 200),
			html: fillTemplate(template.html, values, escapeHtml),
			text: fillTemplate(template.text, values, (value) => value),
		};
	}

	sampleValues(name: string, variables: string[]): Record<string, string> {
		const known = BUILTIN_TEMPLATES[name]?.variables ?? {};
		const catalog = Object.fromEntries(TEMPLATE_KEYS.map((entry) => [entry.key, entry.sample]));
		return Object.fromEntries(variables.map((variable) => [variable, known[variable] ?? catalog[variable] ?? `[${variable}]`]));
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
