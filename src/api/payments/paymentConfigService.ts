import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PaymentConfigRow } from "../../entities/paymentConfig.entity.js";
import { SECRET_MASK } from "../settings/secretMask.js";
import { CURRENCIES, currenciesFor } from "./currencies.js";
import type { PaymentProvider } from "./paymentProvider.js";
import { decryptPaymentSecret, encryptPaymentSecret } from "./paymentSecrets.js";
import { SquareProvider } from "./squareProvider.js";
import { StripeProvider } from "./stripeProvider.js";
import { DEFAULT_PAYMENT_CONFIG, PAYMENT_PROVIDERS, isUuid, normalizeCurrency, parsePrices, parseScopes, type PaymentConfig, type PaymentProviderId, type PaymentSecrets } from "./paymentTypes.js";

const CACHE_MS = 5_000;
const MAX_GRACE_DAYS = 30;

export interface AdminPaymentConfig extends PaymentConfig {
	stripe: PaymentConfig["stripe"] & { secretKey: string; webhookSecret: string };
	square: PaymentConfig["square"] & { accessToken: string; signatureKey: string };
}

export function assertPriceCurrencies(prices: { currency: string }[], allowed: string[]): void {
	const bad = prices.find((price) => !allowed.includes(price.currency));
	if (bad) {
		throw new BadRequest(`${bad.currency} isn't one of the currencies you accept. Add it under Currencies first.`);
	}
}

type Loaded = { config: PaymentConfig; secrets: PaymentSecrets };

function merge(raw: Record<string, unknown>): PaymentConfig {
	const base = DEFAULT_PAYMENT_CONFIG;
	const part = <T extends object>(fallback: T, value: unknown): T => ({ ...fallback, ...((value ?? {}) as Partial<T>) });
	const merged: PaymentConfig = {
		...base,
		...(raw as Partial<PaymentConfig>),
		registration: part(base.registration, raw.registration),
		tax: part(base.tax, raw.tax),
		stripe: part(base.stripe, raw.stripe),
		square: part(base.square, raw.square),
	};
	if (!merged.currencies.includes(merged.currency)) {
		merged.currencies = [merged.currency, ...merged.currencies];
	}
	return merged;
}

@Injectable()
export class PaymentConfigService {
	private cache: { at: number; value: Loaded } | null = null;

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	private async load(): Promise<Loaded> {
		if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
			return this.cache.value;
		}
		const row = await this.dataSource.getRepository(PaymentConfigRow).findOneBy({ id: 1 });
		let secrets: PaymentSecrets = {};
		if (row?.secrets) {
			try {
				secrets = JSON.parse(decryptPaymentSecret(row.secrets)) as PaymentSecrets;
			} catch {
				secrets = {};
			}
		}
		const value = { config: merge(row?.config ?? {}), secrets };
		this.cache = { at: Date.now(), value };
		return value;
	}

	async get(): Promise<PaymentConfig> {
		return (await this.load()).config;
	}

	/** Payments are on only when an admin has enabled them and the chosen provider is fully configured. */
	async isActive(): Promise<boolean> {
		const { config, secrets } = await this.load();
		return config.enabled && this.isConfigured(config, secrets);
	}

	private isConfigured(config: PaymentConfig, secrets: PaymentSecrets): boolean {
		if (config.provider === "stripe") {
			return Boolean(secrets.stripeSecretKey && config.stripe.publishableKey);
		}
		if (config.provider === "square") {
			return Boolean(secrets.squareAccessToken && config.square.applicationId && config.square.locationId);
		}
		return false;
	}

	/** What is needed to authenticate a webhook delivery for the active provider. */
	async webhookCredentials(): Promise<{ stripeSecret?: string; squareKey?: string; squareUrl: string }> {
		const { config, secrets } = await this.load();
		return { stripeSecret: secrets.stripeWebhookSecret, squareKey: secrets.squareSignatureKey, squareUrl: config.square.webhookUrl };
	}

	async provider(): Promise<PaymentProvider> {
		const { config, secrets } = await this.load();
		return this.build(config, secrets);
	}

	private build(config: PaymentConfig, secrets: PaymentSecrets): PaymentProvider {
		if (config.provider === "stripe" && secrets.stripeSecretKey) {
			return new StripeProvider(secrets.stripeSecretKey);
		}
		if (config.provider === "square" && secrets.squareAccessToken) {
			return new SquareProvider(secrets.squareAccessToken, config.square.environment, config.square.locationId);
		}
		throw new BadRequest("Payments are not configured.");
	}

	/** The browser-safe part of the provider settings, used to mount the embedded card element. */
	async clientSettings(): Promise<Record<string, unknown> | null> {
		const { config } = await this.load();
		if (config.provider === "stripe") {
			return { publishableKey: config.stripe.publishableKey };
		}
		if (config.provider === "square") {
			return { applicationId: config.square.applicationId, locationId: config.square.locationId, environment: config.square.environment };
		}
		return null;
	}

	async adminView(): Promise<AdminPaymentConfig> {
		const { config, secrets } = await this.load();
		return {
			...config,
			stripe: { ...config.stripe, secretKey: secrets.stripeSecretKey ? SECRET_MASK : "", webhookSecret: secrets.stripeWebhookSecret ? SECRET_MASK : "" },
			square: { ...config.square, accessToken: secrets.squareAccessToken ? SECRET_MASK : "", signatureKey: secrets.squareSignatureKey ? SECRET_MASK : "" },
		};
	}

	async update(input: Record<string, unknown>): Promise<AdminPaymentConfig> {
		const { config: current, secrets: currentSecrets } = await this.load();
		const next: PaymentConfig = structuredClone(current);
		const secrets: PaymentSecrets = { ...currentSecrets };
		const object = (value: unknown, name: string): Record<string, unknown> => {
			if (value === undefined) {
				return {};
			}
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				throw new BadRequest(`${name} is invalid.`);
			}
			return value as Record<string, unknown>;
		};
		const text = (value: unknown, name: string, max = 200): string => {
			if (typeof value !== "string" || value.length > max) {
				throw new BadRequest(`${name} is invalid.`);
			}
			return value.trim();
		};
		const secret = (value: unknown, name: string, existing: string | undefined): string | undefined => {
			if (value === undefined || value === SECRET_MASK) {
				return existing;
			}
			const trimmed = text(value, name, 500);
			return trimmed === "" ? undefined : trimmed;
		};

		if (input.provider !== undefined) {
			if (input.provider !== null && !(PAYMENT_PROVIDERS as readonly string[]).includes(input.provider as string)) {
				throw new BadRequest("Choose Stripe or Square.");
			}
			next.provider = input.provider as PaymentProviderId | null;
		}
		if (input.currency !== undefined) {
			next.currency = normalizeCurrency(input.currency);
		}
		if (input.currencies !== undefined) {
			if (!Array.isArray(input.currencies) || input.currencies.length === 0 || input.currencies.length > CURRENCIES.length) {
				throw new BadRequest("Choose at least one currency.");
			}
			next.currencies = [...new Set(input.currencies.map((entry) => normalizeCurrency(entry)))];
		}
		if (!next.currencies.includes(next.currency)) {
			next.currencies.unshift(next.currency);
		}
		{
			const allowed = new Set(currenciesFor(next.provider).map((entry) => entry.code));
			const unsupported = next.currencies.filter((code) => !allowed.has(code));
			if (unsupported.length > 0) {
				throw new BadRequest(`${next.provider === "square" ? "Square" : "Stripe"} can't be used with ${unsupported.join(", ")} here. Remove it from the currency list.`);
			}
		}
		if (input.graceDays !== undefined) {
			if (typeof input.graceDays !== "number" || !Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > MAX_GRACE_DAYS) {
				throw new BadRequest(`The grace period must be between 0 and ${MAX_GRACE_DAYS} days.`);
			}
			next.graceDays = input.graceDays;
		}
		if (input.grandfatherExisting !== undefined) {
			if (typeof input.grandfatherExisting !== "boolean") {
				throw new BadRequest("grandfatherExisting must be true or false.");
			}
			next.grandfatherExisting = input.grandfatherExisting;
		}

		const stripe = object(input.stripe, "Stripe settings");
		if (stripe.publishableKey !== undefined) {
			next.stripe.publishableKey = text(stripe.publishableKey, "The Stripe publishable key");
		}
		secrets.stripeSecretKey = secret(stripe.secretKey, "The Stripe secret key", secrets.stripeSecretKey);
		secrets.stripeWebhookSecret = secret(stripe.webhookSecret, "The Stripe webhook signing secret", secrets.stripeWebhookSecret);

		const square = object(input.square, "Square settings");
		if (square.environment !== undefined) {
			if (square.environment !== "sandbox" && square.environment !== "production") {
				throw new BadRequest("Square environment must be sandbox or production.");
			}
			next.square.environment = square.environment;
		}
		if (square.applicationId !== undefined) {
			next.square.applicationId = text(square.applicationId, "The Square application ID");
		}
		if (square.locationId !== undefined) {
			next.square.locationId = text(square.locationId, "The Square location ID");
		}
		if (square.webhookUrl !== undefined) {
			const url = text(square.webhookUrl, "The Square webhook URL", 500);
			if (url && !/^https?:\/\//i.test(url)) {
				throw new BadRequest("The Square webhook URL must start with https://.");
			}
			next.square.webhookUrl = url;
		}
		secrets.squareAccessToken = secret(square.accessToken, "The Square access token", secrets.squareAccessToken);
		secrets.squareSignatureKey = secret(square.signatureKey, "The Square webhook signature key", secrets.squareSignatureKey);

		const registration = object(input.registration, "Registration settings");
		if (registration.enabled !== undefined) {
			next.registration.enabled = registration.enabled === true;
		}
		if (registration.mode !== undefined) {
			if (registration.mode !== "one_time" && registration.mode !== "subscription") {
				throw new BadRequest("Registration mode must be one_time or subscription.");
			}
			next.registration.mode = registration.mode;
		}
		if (registration.prices !== undefined) {
			next.registration.prices = parsePrices(registration.prices, { allowEmpty: true });
			assertPriceCurrencies(next.registration.prices, next.currencies);
		}
		if (registration.planId !== undefined) {
			if (registration.planId !== null && !isUuid(registration.planId)) {
				throw new BadRequest("Choose a subscription plan.");
			}
			next.registration.planId = registration.planId as string | null;
		}
		if (registration.unlocks !== undefined) {
			if (registration.unlocks !== "all" && registration.unlocks !== "scopes" && registration.unlocks !== "none") {
				throw new BadRequest("Registration unlocks must be all, scopes or none.");
			}
			next.registration.unlocks = registration.unlocks;
		}
		if (registration.scopes !== undefined) {
			next.registration.scopes = parseScopes(registration.scopes, { allowEmpty: true });
		}
		if (next.registration.enabled) {
			if (next.registration.mode === "one_time" && next.registration.prices.length === 0) {
				throw new BadRequest("Set a registration price, or turn the registration fee off.");
			}
			if (next.registration.mode === "subscription" && !next.registration.planId) {
				throw new BadRequest("Choose the plan that new accounts subscribe to.");
			}
			if (next.registration.mode === "one_time" && next.registration.unlocks === "scopes" && next.registration.scopes.length === 0) {
				throw new BadRequest("Choose what the registration fee unlocks.");
			}
		}

		const tax = object(input.tax, "Tax settings");
		if (tax.enabled !== undefined) {
			next.tax.enabled = tax.enabled === true;
		}
		if (tax.inclusive !== undefined) {
			next.tax.inclusive = tax.inclusive === true;
		}
		if (tax.rates !== undefined) {
			if (!Array.isArray(tax.rates) || tax.rates.length > 10) {
				throw new BadRequest("Add up to 10 tax rates.");
			}
			next.tax.rates = tax.rates.map((entry) => {
				const rate = (entry ?? {}) as Record<string, unknown>;
				if (typeof rate.name !== "string" || !rate.name.trim() || rate.name.length > 60) {
					throw new BadRequest("Each tax rate needs a name.");
				}
				if (typeof rate.percent !== "number" || !(rate.percent >= 0 && rate.percent <= 100)) {
					throw new BadRequest("A tax rate must be between 0 and 100 percent.");
				}
				return { name: rate.name.trim(), percent: Math.round(rate.percent * 1000) / 1000 };
			});
		}

		if (input.enabled !== undefined) {
			if (typeof input.enabled !== "boolean") {
				throw new BadRequest("enabled must be true or false.");
			}
			next.enabled = input.enabled;
		}
		if (next.enabled) {
			if (!next.provider) {
				throw new BadRequest("Choose a payment provider before turning payments on.");
			}
			if (!this.isConfigured(next, secrets)) {
				throw new BadRequest(next.provider === "stripe" ? "Enter the Stripe publishable and secret keys before turning payments on." : "Enter the Square application ID, location ID and access token before turning payments on.");
			}
			next.enabledAt ??= new Date().toISOString();
		}

		const repository = this.dataSource.getRepository(PaymentConfigRow);
		const row = (await repository.findOneBy({ id: 1 })) ?? repository.create({ id: 1 });
		row.config = next as unknown as Record<string, unknown>;
		row.secrets = encryptPaymentSecret(JSON.stringify(secrets));
		await repository.save(row);
		this.cache = null;
		return this.adminView();
	}

	/** Checks the saved credentials, or the ones being typed in the form, against the provider without saving anything. */
	async testConnection(overrides: Record<string, unknown> | undefined): Promise<{ ok: boolean; detail: string }> {
		const { config, secrets } = await this.load();
		const trial: PaymentConfig = structuredClone(config);
		const trialSecrets: PaymentSecrets = { ...secrets };
		const given = (value: unknown) => (typeof value === "string" && value !== SECRET_MASK && value.trim() ? value.trim() : undefined);
		const provider = (overrides?.provider as PaymentProviderId | undefined) ?? config.provider;
		const stripe = (overrides?.stripe ?? {}) as Record<string, unknown>;
		const square = (overrides?.square ?? {}) as Record<string, unknown>;
		trialSecrets.stripeSecretKey = given(stripe.secretKey) ?? trialSecrets.stripeSecretKey;
		trialSecrets.squareAccessToken = given(square.accessToken) ?? trialSecrets.squareAccessToken;
		trial.square.locationId = given(square.locationId) ?? trial.square.locationId;
		if (square.environment === "sandbox" || square.environment === "production") {
			trial.square.environment = square.environment;
		}
		if (provider !== "stripe" && provider !== "square") {
			return { ok: false, detail: "Choose a provider first." };
		}
		trial.provider = provider;
		const missing = provider === "stripe" ? !trialSecrets.stripeSecretKey : !trialSecrets.squareAccessToken;
		if (missing) {
			return { ok: false, detail: "Enter the API key first." };
		}
		return this.build(trial, trialSecrets).testConnection();
	}
}
