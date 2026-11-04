import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MailServerSettings, type UserAddressMode } from "../../entities/mailServerSettings.entity.js";
import { normalizeDomain, parseAddress } from "./mailAddress.js";

export interface MailServerSettingsView {
	inboundEnabled: boolean;
	inboundPort: number;
	hostname: string | null;
	maxMessageMb: number;
	outboundEnabled: boolean;
	relayFallback: boolean;
	noreplyAddress: string | null;
	noreplyName: string;
	userAddressesEnabled: boolean;
	userAddressMode: UserAddressMode;
	userAddressDomain: string | null;
}

export interface MailServerSettingsUpdate extends Partial<MailServerSettingsView> {}

/** Loads and validates the built-in mail server configuration (a single database row). */
@Injectable()
export class MailSettingsService {

	private listeners = new Set<(settings: MailServerSettingsView) => void>();

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	/** Called after every successful update so the inbound listener can restart. */
	onChange(listener: (settings: MailServerSettingsView) => void): void {
		this.listeners.add(listener);
	}

	async get(): Promise<MailServerSettingsView> {
		const repo = this.dataSource.getRepository(MailServerSettings);
		const row = (await repo.findOneBy({ id: 1 })) ?? (await repo.save(repo.create({ id: 1 })));
		return {
			inboundEnabled: row.inboundEnabled,
			inboundPort: row.inboundPort,
			hostname: row.hostname,
			maxMessageMb: row.maxMessageMb,
			outboundEnabled: row.outboundEnabled,
			relayFallback: row.relayFallback,
			noreplyAddress: row.noreplyAddress,
			noreplyName: row.noreplyName,
			userAddressesEnabled: row.userAddressesEnabled,
			userAddressMode: row.userAddressMode,
			userAddressDomain: row.userAddressDomain,
		};
	}

	async update(input: MailServerSettingsUpdate): Promise<MailServerSettingsView> {
		const current = await this.get();
		const next: MailServerSettingsView = { ...current };

		if (input.inboundEnabled !== undefined) next.inboundEnabled = input.inboundEnabled === true;
		if (input.outboundEnabled !== undefined) next.outboundEnabled = input.outboundEnabled === true;
		if (input.relayFallback !== undefined) next.relayFallback = input.relayFallback === true;
		if (input.userAddressesEnabled !== undefined) next.userAddressesEnabled = input.userAddressesEnabled === true;

		if (input.inboundPort !== undefined) {
			if (!Number.isInteger(input.inboundPort) || input.inboundPort < 1 || input.inboundPort > 65535) {
				throw new BadRequest("The inbound port must be between 1 and 65535.");
			}
			next.inboundPort = input.inboundPort;
		}
		if (input.maxMessageMb !== undefined) {
			if (!Number.isInteger(input.maxMessageMb) || input.maxMessageMb < 1 || input.maxMessageMb > 50) {
				throw new BadRequest("The maximum message size must be between 1 and 50 MB.");
			}
			next.maxMessageMb = input.maxMessageMb;
		}
		if (input.hostname !== undefined) {
			next.hostname = input.hostname === null || input.hostname === "" ? null : normalizeDomain(input.hostname);
			if (input.hostname && !next.hostname) throw new BadRequest("Enter a valid server hostname, e.g. mail.example.com.");
		}
		if (input.noreplyName !== undefined) {
			const name = typeof input.noreplyName === "string" ? input.noreplyName.replace(/[\r\n\0"<>]/g, "").trim() : "";
			if (!name || name.length > 100) throw new BadRequest("The sender name must be 1-100 characters without quotes or angle brackets.");
			next.noreplyName = name;
		}
		if (input.noreplyAddress !== undefined) {
			if (input.noreplyAddress === null || input.noreplyAddress === "") {
				next.noreplyAddress = null;
			} else {
				const parsed = parseAddress(input.noreplyAddress);
				if (!parsed) throw new BadRequest("Enter a valid noreply address, e.g. noreply@example.com.");
				next.noreplyAddress = parsed.address;
			}
		}
		if (input.userAddressMode !== undefined) {
			if (input.userAddressMode !== "username" && input.userAddressMode !== "random") {
				throw new BadRequest("The user address mode must be username or random.");
			}
			next.userAddressMode = input.userAddressMode;
		}
		if (input.userAddressDomain !== undefined) {
			if (input.userAddressDomain === null || input.userAddressDomain === "") {
				next.userAddressDomain = null;
			} else {
				next.userAddressDomain = normalizeDomain(input.userAddressDomain);
				if (!next.userAddressDomain) throw new BadRequest("Enter a valid domain for user addresses.");
			}
		}
		if (next.userAddressesEnabled && !next.userAddressDomain) {
			throw new BadRequest("Choose a domain for user addresses before turning the feature on.");
		}

		await this.dataSource.getRepository(MailServerSettings).update({ id: 1 }, {
			inboundEnabled: next.inboundEnabled,
			inboundPort: next.inboundPort,
			hostname: next.hostname,
			maxMessageMb: next.maxMessageMb,
			outboundEnabled: next.outboundEnabled,
			relayFallback: next.relayFallback,
			noreplyAddress: next.noreplyAddress,
			noreplyName: next.noreplyName,
			userAddressesEnabled: next.userAddressesEnabled,
			userAddressMode: next.userAddressMode,
			userAddressDomain: next.userAddressDomain,
		});
		for (const listener of this.listeners) listener(next);
		return next;
	}
}
