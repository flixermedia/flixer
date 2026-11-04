import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import dns from "node:dns";
import { DataSource, Like } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MailDomain, type MailDomainDnsChecks } from "../../entities/mailDomain.entity.js";
import { Mailbox } from "../../entities/mailbox.entity.js";
import { domainCovers, normalizeDomain } from "./mailAddress.js";
import { decryptMailSecret, encryptMailSecret } from "./mailSecrets.js";
import { MailSettingsService } from "./mailSettingsService.js";

const OWNERSHIP_PREFIX = "flixer-verification=";

export interface DnsRecord {
	purpose: "ownership" | "mx" | "spf" | "dkim" | "dmarc";
	type: "TXT" | "MX";
	name: string;
	value: string;
	priority?: number;
	required: boolean;
	note: string;
}

function publicKeyBase64(pem: string): string {
	return pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
}

function flatten(records: string[][]): string[] {
	return records.map((chunks) => chunks.join(""));
}

/** Domains the mail server may send from and receive for, with DNS verification and DKIM key management. */
@Injectable()
export class MailDomainService {

	private readonly resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly settings: MailSettingsService,
	) {}

	async list() {
		const settings = await this.settings.get();
		const domains = await this.dataSource.getRepository(MailDomain).find({ order: { domain: "ASC" } });
		return domains.map((domain) => this.toView(domain, settings.hostname));
	}

	async get(id: string) {
		const settings = await this.settings.get();
		return this.toView(await this.require(id), settings.hostname);
	}

	async create(rawDomain: string, allowSubdomains: boolean) {
		const domain = normalizeDomain(rawDomain);
		if (!domain) throw new BadRequest("Enter a valid domain name, e.g. example.com.");
		const repo = this.dataSource.getRepository(MailDomain);
		if (await repo.existsBy({ domain })) throw new Conflict("This domain has already been added.");

		const { publicKey, privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			publicKeyEncoding: { type: "spki", format: "pem" },
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
		});
		const created = await repo.save(repo.create({
			id: randomUUID(),
			domain,
			allowSubdomains,
			verificationToken: randomBytes(24).toString("hex"),
			dkimSelector: "flixer",
			dkimPublicKey: publicKey,
			dkimPrivateKey: encryptMailSecret(privateKey),
			dnsChecks: {},
		}));
		return this.get(created.id);
	}

	async update(id: string, input: { allowSubdomains?: boolean }) {
		const domain = await this.require(id);
		if (input.allowSubdomains !== undefined) {
			domain.allowSubdomains = input.allowSubdomains === true;
			await this.dataSource.getRepository(MailDomain).save(domain);
		}
		return this.get(id);
	}

	async remove(id: string): Promise<void> {
		const domain = await this.require(id);
		const inUse = await this.dataSource.getRepository(Mailbox).findBy({ address: Like(`%@%${domain.domain}`) });
		if (inUse.some((box) => domainCovers(domain.domain, domain.allowSubdomains, box.address.slice(box.address.lastIndexOf("@") + 1)))) {
			throw new Conflict("Delete this domain's mailboxes before removing the domain.");
		}
		await this.dataSource.getRepository(MailDomain).delete({ id });
	}

	/** Generates a new DKIM key and selector; the old DNS record can be removed once the new one is published. */
	async rotateDkim(id: string) {
		const domain = await this.require(id);
		const { publicKey, privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			publicKeyEncoding: { type: "spki", format: "pem" },
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
		});
		const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
		domain.dkimSelector = `flixer${stamp}${randomBytes(2).toString("hex")}`;
		domain.dkimPublicKey = publicKey;
		domain.dkimPrivateKey = encryptMailSecret(privateKey);
		domain.dnsChecks = { ...domain.dnsChecks, dkim: { ok: false, detail: "A new key was generated. Publish the new DKIM record." } };
		await this.dataSource.getRepository(MailDomain).save(domain);
		return this.get(id);
	}

	/** Re-checks every DNS record. Ownership is required; MX/SPF/DKIM/DMARC are advisory but needed for good delivery. */
	async verify(id: string) {
		const domain = await this.require(id);
		const settings = await this.settings.get();
		const checks: MailDomainDnsChecks = {};

		const ownership = await this.lookupTxt(`_flixer-challenge.${domain.domain}`);
		const ownershipOk = ownership.records.some((record) => record.trim() === `${OWNERSHIP_PREFIX}${domain.verificationToken}`);
		checks.ownership = { ok: ownershipOk, detail: ownershipOk ? "Ownership TXT record found." : ownership.error ?? "The ownership TXT record was not found or does not match." };
		if (ownershipOk && !domain.verifiedAt) domain.verifiedAt = new Date();
		if (!ownershipOk) domain.verifiedAt = null;

		const mx = await this.resolver.resolveMx(domain.domain).catch(() => [] as dns.MxRecord[]);
		const hostname = settings.hostname;
		const mxOk = hostname ? mx.some((record) => record.exchange.toLowerCase().replace(/\.$/, "") === hostname) : mx.length > 0;
		checks.mx = {
			ok: mxOk,
			detail: mxOk ? "MX record points to this server." : mx.length === 0 ? "No MX record found." : `MX points to ${mx.map((record) => record.exchange).join(", ")}.`,
		};

		const spf = (await this.lookupTxt(domain.domain)).records.find((record) => record.toLowerCase().startsWith("v=spf1"));
		const spfOk = Boolean(spf && (!hostname || spf.includes(hostname) || /(^|\s)[+]?mx(\s|$)/i.test(spf)));
		checks.spf = { ok: spfOk, detail: spfOk ? "SPF record authorises this server." : spf ? "An SPF record exists but doesn't include this server." : "No SPF record found." };

		const dkim = (await this.lookupTxt(`${domain.dkimSelector}._domainkey.${domain.domain}`)).records.join("");
		const dkimOk = dkim.replace(/\s+/g, "").includes(publicKeyBase64(domain.dkimPublicKey));
		checks.dkim = { ok: dkimOk, detail: dkimOk ? "DKIM public key is published." : dkim ? "A DKIM record exists but the key doesn't match." : "No DKIM record found." };

		const dmarc = (await this.lookupTxt(`_dmarc.${domain.domain}`)).records.find((record) => record.toLowerCase().startsWith("v=dmarc1"));
		checks.dmarc = { ok: Boolean(dmarc), detail: dmarc ? "DMARC policy found." : "No DMARC record found." };

		domain.dnsChecks = checks;
		domain.lastCheckedAt = new Date();
		await this.dataSource.getRepository(MailDomain).save(domain);
		return this.get(id);
	}

	/** The verified domain that covers `host`, preferring an exact match over a wildcard parent. */
	async findForHost(host: string, options: { verifiedOnly?: boolean } = {}): Promise<MailDomain | null> {
		const domains = await this.dataSource.getRepository(MailDomain).find();
		const matches = domains
			.filter((domain) => (!options.verifiedOnly || domain.verifiedAt) && domainCovers(domain.domain, domain.allowSubdomains, host))
			.sort((a, b) => b.domain.length - a.domain.length);
		return matches[0] ?? null;
	}

	/** DKIM key material for signing mail whose From domain is `host`. */
	async signingKey(host: string): Promise<{ domainName: string; keySelector: string; privateKey: string } | null> {
		const domain = await this.findForHost(host, { verifiedOnly: true });
		if (!domain) return null;
		return { domainName: domain.domain, keySelector: domain.dkimSelector, privateKey: decryptMailSecret(domain.dkimPrivateKey) };
	}

	dnsRecords(domain: MailDomain, hostname: string | null): DnsRecord[] {
		const host = hostname ?? `mail.${domain.domain}`;
		const key = publicKeyBase64(domain.dkimPublicKey);
		return [
			{ purpose: "ownership", type: "TXT", name: `_flixer-challenge.${domain.domain}`, value: `${OWNERSHIP_PREFIX}${domain.verificationToken}`, required: true, note: "Proves you control this domain." },
			{ purpose: "mx", type: "MX", name: domain.domain, value: host, priority: 10, required: false, note: "Needed to receive mail. Point it at the server's hostname." },
			{ purpose: "spf", type: "TXT", name: domain.domain, value: `v=spf1 a:${host} ~all`, required: false, note: "Authorises this server to send for the domain. Merge with any existing SPF record." },
			{ purpose: "dkim", type: "TXT", name: `${domain.dkimSelector}._domainkey.${domain.domain}`, value: `v=DKIM1; k=rsa; p=${key}`, required: false, note: "Lets receivers verify messages were signed by this server." },
			{ purpose: "dmarc", type: "TXT", name: `_dmarc.${domain.domain}`, value: "v=DMARC1; p=quarantine; adkim=r; aspf=r", required: false, note: "Tells receivers what to do with unauthenticated mail." },
		];
	}

	private toView(domain: MailDomain, hostname: string | null) {
		return {
			id: domain.id,
			domain: domain.domain,
			allowSubdomains: domain.allowSubdomains,
			verified: domain.verifiedAt !== null,
			verifiedAt: domain.verifiedAt,
			dkimSelector: domain.dkimSelector,
			checks: domain.dnsChecks,
			lastCheckedAt: domain.lastCheckedAt,
			records: this.dnsRecords(domain, hostname),
			createdAt: domain.createdAt,
		};
	}

	private async require(id: string): Promise<MailDomain> {
		const domain = await this.dataSource.getRepository(MailDomain).findOneBy({ id });
		if (!domain) throw new NotFound("Domain not found.");
		return domain;
	}

	private async lookupTxt(name: string): Promise<{ records: string[]; error?: string }> {
		try {
			return { records: flatten(await this.resolver.resolveTxt(name)) };
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENODATA" || code === "ENOTFOUND") return { records: [] };
			return { records: [], error: `DNS lookup failed (${code ?? "unknown error"}). Try again shortly.` };
		}
	}
}
