import { Inject, Injectable, logger } from "@tsed/di";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Mailbox } from "../../entities/mailbox.entity.js";
import { MailMessage, type MailAttachmentInfo } from "../../entities/mailMessage.entity.js";
import { NotificationService } from "../notifications/notificationService.js";
import { headerSafe } from "./mailAddress.js";
import { attachmentDirectory } from "./mailMessageService.js";

export interface InboundMessage {
	mailboxId: string;
	fromAddress: string;
	fromName: string | null;
	toAddresses: string[];
	subject: string;
	text: string;
	html: string | null;
	messageId: string | null;
	authResults: Record<string, string> | null;
	remoteAddress: string | null;
	attachments: MailAttachmentInfo[];
	files?: Array<{ id: string; content: Buffer }>;
}

/** Stores received mail and raises a notification when it lands in a user's own address. */
@Injectable()
export class MailInboxService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly notifications: NotificationService,
	) {}

	async store(message: InboundMessage): Promise<MailMessage> {
		const id = randomUUID();
		if (message.files && message.files.length > 0) {
			const directory = attachmentDirectory(id);
			await mkdir(directory, { recursive: true, mode: 0o700 });
			for (const file of message.files) await writeFile(path.join(directory, file.id), file.content, { mode: 0o600 });
		}

		const repo = this.dataSource.getRepository(MailMessage);
		const saved = await repo.save(repo.create({
			id,
			mailboxId: message.mailboxId,
			direction: "inbound",
			status: "received",
			fromAddress: message.fromAddress,
			fromName: message.fromName,
			toAddresses: message.toAddresses,
			subject: message.subject.slice(0, 998),
			text: message.text,
			html: message.html,
			messageId: message.messageId,
			attachments: message.attachments,
			authResults: message.authResults,
			remoteAddress: message.remoteAddress,
			inReplyTo: null,
			isSystem: false,
		}));
		void this.notifyOwner(saved);
		return saved;
	}

	private async notifyOwner(message: MailMessage): Promise<void> {
		try {
			const mailbox = await this.dataSource.getRepository(Mailbox).findOneBy({ id: message.mailboxId ?? "" });
			if (!mailbox?.userId) return;
			const sender = message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress;
			await this.notifications.send({
				kind: "mail",
				title: headerSafe(message.subject, 120) || "(no subject)",
				body: `From ${sender}`,
				url: `/inbox?message=${message.id}`,
			}, [mailbox.userId]);
		} catch (error) {
			logger().debug("Could not notify a user about new mail.", error);
		}
	}
}
