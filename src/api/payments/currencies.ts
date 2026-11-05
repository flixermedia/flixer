export interface CurrencyInfo {
	code: string;
	name: string;
	/** Digits after the decimal point; prices are stored as whole minor units (10^-digits). */
	digits: number;
	/** Square only settles a handful of currencies. */
	square: boolean;
}

/** Currencies whose minor unit matches how both Stripe and Square count amounts. */
export const CURRENCIES: readonly CurrencyInfo[] = [
	{ code: "USD", name: "US dollar", digits: 2, square: true },
	{ code: "EUR", name: "Euro", digits: 2, square: true },
	{ code: "GBP", name: "British pound", digits: 2, square: true },
	{ code: "CAD", name: "Canadian dollar", digits: 2, square: true },
	{ code: "AUD", name: "Australian dollar", digits: 2, square: true },
	{ code: "JPY", name: "Japanese yen", digits: 0, square: true },
	{ code: "CHF", name: "Swiss franc", digits: 2, square: false },
	{ code: "SEK", name: "Swedish krona", digits: 2, square: false },
	{ code: "NOK", name: "Norwegian krone", digits: 2, square: false },
	{ code: "DKK", name: "Danish krone", digits: 2, square: false },
	{ code: "PLN", name: "Polish zloty", digits: 2, square: false },
	{ code: "CZK", name: "Czech koruna", digits: 2, square: false },
	{ code: "NZD", name: "New Zealand dollar", digits: 2, square: false },
	{ code: "SGD", name: "Singapore dollar", digits: 2, square: false },
	{ code: "HKD", name: "Hong Kong dollar", digits: 2, square: false },
	{ code: "MXN", name: "Mexican peso", digits: 2, square: false },
	{ code: "BRL", name: "Brazilian real", digits: 2, square: false },
	{ code: "INR", name: "Indian rupee", digits: 2, square: false },
	{ code: "ZAR", name: "South African rand", digits: 2, square: false },
	{ code: "KRW", name: "South Korean won", digits: 0, square: false },
	{ code: "AED", name: "UAE dirham", digits: 2, square: false },
	{ code: "TRY", name: "Turkish lira", digits: 2, square: false },
	{ code: "RON", name: "Romanian leu", digits: 2, square: false },
];

const BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

export function currencyInfo(code: string): CurrencyInfo | undefined {
	return BY_CODE.get(code);
}

export function currenciesFor(provider: "stripe" | "square" | null): CurrencyInfo[] {
	return CURRENCIES.filter((currency) => provider !== "square" || currency.square);
}
