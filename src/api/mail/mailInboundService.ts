import { Inject, Injectable, logger } from "@tsed/di";
import { randomUUID, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { authenticate } from "mailauth";
import { simpleParser, type AddressObject } from "mailparser";
import { SMTPServer, type SMTPServerSession } from "smtp-server";
import { generate } from "selfsigned";
import { DataSource } from "typeorm";
import { dataPath } from "../../config/dataPath.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Mailbox } from "../../entities/mailbox.entity.js";
import type { MailAttachmentInfo } from "../../entities/mailMessage.entity.js";
import { parseAddress } from "./mailAddress.js";
import { MailDomainService } from "./mailDomainService.js";
import { MailInboxService } from "./mailInboxService.js";
import { MailSettingsService, type MailServerSettingsView } from "./mailSettingsService.js";

const MAX_RECIPIENTS = 20;
const MAX_CLIENTS = 50;
const MAX_CONNECTIONS_PER_IP = 5;
const MAX_MESSAGES_PER_IP_HOUR = 120;
const AUTH_TIMEOUT_MS = 10_000;
const CERT_RENEW_BEFORE_MS = 30 * 86_400_000;

function addressList(value: AddressObject | AddressObject[] | undefined): string[] {
	const objects = value === undefined ? [] : Array.isArray(value) ? value : [value];
	return objects.flatMap((object) => object.value.map((entry) => entry.address?.toLowerCase() ?? "")).filter(Boolean);
}

/** Receives mail for Flixer mailboxes. It never relays: only recipients that exist locally are accepted. */
@Injectable()
export class MailInboundService {

	private server?: SMTPServer;
	private status: { listening: boolean; port: number | null; error: string | null } = { listening: false, port: null, error: null };
	private readonly connections = new Map<string, number>();
	private readonly hourly = new Map<string, { count: number; resetAt: number }>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly settings: MailSettingsService,
		private readonly domains: MailDomainService,
		private readonly inbox: MailInboxService,
	) {}

	async $onReady(): Promise<void> {
		this.settings.onChange(() => void this.restart());
		await this.restart();
	}

	async $onDestroy(): Promise<void> {
		await this.stop();
	}

	getStatus() {
		return { ...this.status };
	}

	async restart(): Promise<void> {
		await this.stop();
		try {
			const settings = await this.settings.get();
			if (!settings.inboundEnabled) return;
			await this.start(settings);
		} catch (error) {
			this.status = { listening: false, port: null, error: error instanceof Error ? error.message : String(error) };
			logger().error("The inbound mail server could not start.", error);
		}
	}

	private async start(settings: MailServerSettingsView): Promise<void> {
		const { key, cert } = await this.tlsMaterial(settings.hostname);
		const server = new SMTPServer({
			name: settings.hostname ?? os.hostname(),
			banner: "Flixer mail",
			secure: false,
			key,
			cert,
			// Inbound only: no authentication, no relaying.
			disabledCommands: ["AUTH"],
			authOptional: true,
			size: settings.maxMessageMb * 1024 * 1024,
			maxClients: MAX_CLIENTS,
			socketTimeout: 60_000,
			closeTimeout: 5_000,
			onConnect: (session, callback) => {
				const ip = session.remoteAddress;
				const open = this.connections.get(ip) ?? 0;
				if (open >= MAX_CONNECTIONS_PER_IP) return callback(Object.assign(new Error("Too many connections from your address"), { responseCode: 421 }));
				this.connections.set(ip, open + 1);
				callback();
			},
			onClose: (session) => {
				const open = (this.connections.get(session.remoteAddress) ?? 1) - 1;
				if (open <= 0) this.connections.delete(session.remoteAddress);
				else this.connections.set(session.remoteAddress, open);
			},
			onMailFrom: (address, _session, callback) => {
				if (address.address && !parseAddress(address.address)) {
					return callback(Object.assign(new Error("Invalid sender address"), { responseCode: 553 }));
				}
				callback();
			},
			onRcptTo: (address, session, callback) => {
				void this.acceptRecipient(address.address, session).then(
					() => callback(),
					(error: Error & { responseCode?: number }) => callback(error),
				);
			},
			onData: (stream, session, callback) => {
				void this.receive(stream, session).then(
					() => callback(),
					(error: Error & { responseCode?: number }) => callback(error),
				);
			},
		});

		server.on("error", (error) => {
			logger().warn("Inbound mail server error.", error);
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(settings.inboundPort, () => {
				server.off("error", reject);
				resolve();
			});
		});
		this.server = server;
		this.status = { listening: true, port: settings.inboundPort, error: null };
		logger().info(`Inbound mail server listening on port ${settings.inboundPort}.`);
	}

	private async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		this.status = { listening: false, port: null, error: null };
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	private async acceptRecipient(rawAddress: string, session: SMTPServerSession): Promise<void> {
		const parsed = parseAddress(rawAddress);
		const reject = (message: string, code = 550) => Object.assign(new Error(message), { responseCode: code });
		if (!parsed) throw reject("5.1.3 Invalid recipient address", 553);
		if (session.envelope.rcptTo.length >= MAX_RECIPIENTS) throw reject("4.5.3 Too many recipients", 452);

		const mailbox = await this.dataSource.getRepository(Mailbox).findOneBy({ address: parsed.address });
		if (!mailbox || mailbox.kind === "system" || !mailbox.enabled || !(await this.domains.findForHost(parsed.domain, { verifiedOnly: true }))) {
			throw reject("5.1.1 Mailbox unavailable");
		}
	}

	private async receive(stream: NodeJS.ReadableStream & { sizeExceeded?: boolean }, session: SMTPServerSession): Promise<void> {
		const ip = session.remoteAddress;
		const now = Date.now();
		const bucket = this.hourly.get(ip);
		if (!bucket || bucket.resetAt < now) this.hourly.set(ip, { count: 1, resetAt: now + 3_600_000 });
		else if (++bucket.count > MAX_MESSAGES_PER_IP_HOUR) throw Object.assign(new Error("4.7.1 Rate limit exceeded, try again later"), { responseCode: 451 });

		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		if (stream.sizeExceeded) throw Object.assign(new Error("5.3.4 Message too large"), { responseCode: 552 });
		const raw = Buffer.concat(chunks);

		const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
		const authResults = await this.authResults(raw, session);
		if (authResults.dmarc === "fail" && authResults.dmarcPolicy === "reject") {
			throw Object.assign(new Error("5.7.1 Message rejected by the sender's DMARC policy"), { responseCode: 550 });
		}

		const from = parsed.from?.value[0];
		const attachments: MailAttachmentInfo[] = [];
		const files: Array<{ id: string; content: Buffer }> = [];
		for (const attachment of parsed.attachments) {
			const id = randomUUID();
			attachments.push({ id, filename: (attachment.filename ?? "attachment").replace(/[\r\n\0/\\]/g, "_").slice(0, 200), contentType: attachment.contentType.slice(0, 100), size: attachment.size });
			files.push({ id, content: attachment.content });
		}

		const mailboxes = this.dataSource.getRepository(Mailbox);
		const envelopeFrom = session.envelope.mailFrom ? session.envelope.mailFrom.address : "";
		for (const recipient of session.envelope.rcptTo) {
			const mailbox = await mailboxes.findOneBy({ address: recipient.address.toLowerCase() });
			if (!mailbox || !mailbox.enabled || mailbox.kind === "system") continue;
			await this.inbox.store({
				mailboxId: mailbox.id,
				fromAddress: (from?.address ?? envelopeFrom ?? "unknown").toLowerCase().slice(0, 320) || "unknown",
				fromName: from?.name ? from.name.slice(0, 200) : null,
				toAddresses: addressList(parsed.to).slice(0, 50),
				subject: parsed.subject ?? "",
				text: parsed.text ?? "",
				html: typeof parsed.html === "string" ? parsed.html : null,
				messageId: parsed.messageId?.slice(0, 998) ?? null,
				authResults: { spf: authResults.spf, dkim: authResults.dkim, dmarc: authResults.dmarc },
				remoteAddress: ip,
				attachments,
				files,
			});
		}
	}

	private async authResults(raw: Buffer, session: SMTPServerSession): Promise<Record<string, string>> {
		try {
			const result = await Promise.race([
				authenticate(raw, {
					ip: session.remoteAddress,
					helo: session.hostNameAppearsAs ?? session.clientHostname,
					sender: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
					mta: os.hostname(),
				}),
				new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), AUTH_TIMEOUT_MS).unref()),
			]);
			return {
				spf: result.spf && "status" in result.spf ? String(result.spf.status?.result ?? "none") : "none",
				dkim: String(result.dkim?.results?.[0]?.status?.result ?? "none"),
				dmarc: result.dmarc && "status" in result.dmarc ? String(result.dmarc.status?.result ?? "none") : "none",
				dmarcPolicy: result.dmarc && "policy" in result.dmarc ? String(result.dmarc.policy ?? "none") : "none",
			};
		} catch {
			return { spf: "temperror", dkim: "temperror", dmarc: "temperror", dmarcPolicy: "none" };
		}
	}

	/** A unique self-signed certificate for opportunistic STARTTLS, regenerated before it expires. */
	private async tlsMaterial(hostname: string | null): Promise<{ key: string; cert: string }> {
		const directory = dataPath("mail", "tls");
		const keyPath = `${directory}/server.key`;
		const certPath = `${directory}/server.crt`;
		try {
			const [key, cert] = await Promise.all([readFile(keyPath, "utf8"), readFile(certPath, "utf8")]);
			const certificate = new X509Certificate(cert);
			const expires = new Date(certificate.validTo).getTime();
			const matchesHost = !hostname || certificate.subject.includes(`CN=${hostname}`);
			if (expires - Date.now() > CERT_RENEW_BEFORE_MS && matchesHost) return { key, cert };
		} catch {
			// Generate a new pair below.
		}
		const notAfterDate = new Date(Date.now() + 365 * 86_400_000);
		const pems = await generate([{ name: "commonName", value: hostname ?? os.hostname() }], { keySize: 2048, algorithm: "sha256", notAfterDate });
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await writeFile(keyPath, pems.private, { mode: 0o600 });
		await writeFile(certPath, pems.cert, { mode: 0o644 });
		return { key: pems.private, cert: pems.cert };
	}
}
