import { Inject, Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import sanitizeHtml from "sanitize-html";
import { Brackets, DataSource } from "typeorm";
import { dataPath } from "../../config/dataPath.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MailMessage } from "../../entities/mailMessage.entity.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE_MAX = 100;

export function attachmentDirectory(messageId: string): string {
	return dataPath("mail", "attachments", messageId);
}

/** Strips scripts, forms, remote content and event handlers. Remote images are removed to block tracking pixels. */
export function sanitizeEmailHtml(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: ["a", "abbr", "b", "blockquote", "br", "caption", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "center", "font"],
		allowedAttributes: {
			a: ["href", "title", "name"],
			img: ["src", "alt", "width", "height"],
			"*": ["style", "align", "valign", "width", "height", "colspan", "rowspan", "bgcolor", "color", "dir", "lang"],
			font: ["color", "face", "size"],
		},
		allowedSchemes: ["http", "https", "mailto", "tel"],
		allowedSchemesByTag: { img: ["data"] },
		allowedStyles: {
			"*": {
				color: [/^[#(),.%\w\s-]+$/],
				"background-color": [/^[#(),.%\w\s-]+$/],
				"font-size": [/^[\d.]+(px|em|rem|%|pt)$/],
				"font-weight": [/^[\w]+$/],
				"font-style": [/^[\w]+$/],
				"font-family": [/^[\w\s,'"-]+$/],
				"text-align": [/^(left|right|center|justify)$/],
				"text-decoration": [/^[\w\s-]+$/],
				padding: [/^[\d.\s%a-z-]+$/],
				margin: [/^[\d.\s%a-z-]+$/],
				border: [/^[\w\s#(),.%-]+$/],
				"border-radius": [/^[\d.\s%a-z-]+$/],
				width: [/^[\d.]+(px|em|rem|%)$/],
				"max-width": [/^[\d.]+(px|em|rem|%)$/],
				"line-height": [/^[\d.]+(px|em|rem|%)?$/],
			},
		},
		transformTags: {
			a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
		},
		disallowedTagsMode: "discard",
	});
}

export interface MessageQuery {
	mailboxId?: string;
	direction?: "inbound" | "outbound";
	search?: string;
	page?: number;
	limit?: number;
	unreadOnly?: boolean;
}

function summarise(message: MailMessage) {
	return {
		id: message.id,
		mailboxId: message.mailboxId,
		direction: message.direction,
		status: message.status,
		from: message.fromAddress,
		fromName: message.fromName,
		to: message.toAddresses,
		subject: message.subject,
		preview: message.text.replace(/\s+/g, " ").trim().slice(0, 160),
		hasAttachments: message.attachments.length > 0,
		read: message.direction === "outbound" || message.readAt !== null,
		createdAt: message.createdAt,
	};
}

/** Browsing, reading and deleting stored messages for both admins and users. */
@Injectable()
export class MailMessageService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	private get repo() {
		return this.dataSource.getRepository(MailMessage);
	}

	async list(query: MessageQuery) {
		const limit = Math.min(Math.max(Math.trunc(query.limit ?? 30), 1), PAGE_SIZE_MAX);
		const page = Math.max(Math.trunc(query.page ?? 1), 1);
		const builder = this.repo.createQueryBuilder("m").select(["m.id", "m.mailboxId", "m.direction", "m.status", "m.fromAddress", "m.fromName", "m.toAddresses", "m.subject", "m.text", "m.attachments", "m.readAt", "m.createdAt"]);
		if (query.mailboxId) builder.andWhere("m.mailboxId = :mailboxId", { mailboxId: query.mailboxId });
		if (query.direction) builder.andWhere("m.direction = :direction", { direction: query.direction });
		if (query.unreadOnly) builder.andWhere("m.readAt IS NULL AND m.direction = 'inbound'");
		const search = query.search?.trim().slice(0, 100);
		if (search) {
			const like = `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
			builder.andWhere(new Brackets((qb) => qb.where("m.subject ILIKE :like", { like }).orWhere("m.fromAddress ILIKE :like", { like }).orWhere("m.text ILIKE :like", { like })));
		}
		const [rows, total] = await builder.orderBy("m.createdAt", "DESC").skip((page - 1) * limit).take(limit).getManyAndCount();
		return { total, page, limit, items: rows.map(summarise) };
	}

	async get(id: string, scope: { mailboxId?: string; direction?: "inbound" } = {}) {
		const message = await this.find(id, scope);
		return {
			...summarise(message),
			text: message.text,
			html: message.html ? sanitizeEmailHtml(message.html) : null,
			messageId: message.messageId,
			authResults: message.authResults,
			remoteAddress: message.remoteAddress,
			attempts: message.attempts,
			lastError: message.lastError,
			sentAt: message.sentAt,
			attachments: message.attachments,
		};
	}

	async markRead(id: string, scope: { mailboxId?: string; direction?: "inbound" } = {}): Promise<void> {
		const message = await this.find(id, scope);
		if (message.direction === "inbound" && message.readAt === null) {
			await this.repo.update({ id }, { readAt: new Date() });
		}
	}

	async remove(id: string, scope: { mailboxId?: string; direction?: "inbound" } = {}): Promise<void> {
		await this.find(id, scope);
		await this.repo.delete({ id });
		await rm(attachmentDirectory(id), { recursive: true, force: true });
	}

	/** Resolves the on-disk path of an attachment after checking the caller may see the message. */
	async attachment(id: string, attachmentId: string, scope: { mailboxId?: string; direction?: "inbound" } = {}) {
		const message = await this.find(id, scope);
		const info = message.attachments.find((item) => item.id === attachmentId);
		if (!info || !UUID.test(attachmentId)) throw new NotFound("Attachment not found.");
		const file = path.join(attachmentDirectory(id), attachmentId);
		const size = await stat(file).then((value) => value.size).catch(() => null);
		if (size === null) throw new NotFound("The attachment file is no longer available.");
		return { info, stream: createReadStream(file), size };
	}

	private async find(id: string, scope: { mailboxId?: string; direction?: "inbound" }): Promise<MailMessage> {
		if (!UUID.test(id)) throw new NotFound("Message not found.");
		const message = await this.repo.findOneBy({ id });
		if (!message || (scope.mailboxId && message.mailboxId !== scope.mailboxId) || (scope.direction && message.direction !== scope.direction)) {
			throw new NotFound("Message not found.");
		}
		return message;
	}
}
