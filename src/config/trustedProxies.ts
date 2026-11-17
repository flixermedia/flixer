import ipaddr from "ipaddr.js";

interface TrustedProxyConfig {
	enabled: boolean;
	addresses: string[];
}

export const DEFAULT_TRUSTED_PROXIES: TrustedProxyConfig = { enabled: false, addresses: [] };

let activeRanges: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]> = [];

export function validateTrustedProxyConfig(value: unknown): TrustedProxyConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Trusted proxy settings must be an object.");
	const config = value as Record<string, unknown>;
	if (typeof config.enabled !== "boolean" || !Array.isArray(config.addresses) || config.addresses.length > 32) {
		throw new Error("Trusted proxy settings require an enabled flag and up to 32 addresses.");
	}
	if (config.enabled && config.addresses.length === 0) throw new Error("Add at least one trusted proxy address before enabling proxy trust.");
	const addresses = config.addresses.map((entry) => {
		if (typeof entry !== "string" || entry.length > 64 || entry.trim() !== entry || (!ipaddr.isValid(entry) && !ipaddr.isValidCIDR(entry))) {
			throw new Error("Trusted proxies must be valid IP addresses or CIDRs.");
		}
		if (entry.includes("/")) {
			const [address, prefix] = ipaddr.parseCIDR(entry);
			if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress() && prefix < 96) {
				throw new Error("IPv4-mapped proxy CIDRs must use a prefix of at least 96.");
			}
		}
		return entry;
	});
	return { enabled: config.enabled, addresses: [...new Set(addresses)] };
}

export function setTrustedProxyConfig(value: TrustedProxyConfig): void {
	const config = validateTrustedProxyConfig(value);
	activeRanges = config.enabled ? config.addresses.map((entry) => {
		if (!entry.includes("/")) {
			const address = ipaddr.process(entry);
			return [address, address.kind() === "ipv4" ? 32 : 128];
		}
		const [address, prefix] = ipaddr.parseCIDR(entry);
		if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) return [address.toIPv4Address(), prefix - 96];
		return [address, prefix];
	}) : [];
}

export function isTrustedProxy(value: string): boolean {
	if (!ipaddr.isValid(value)) return false;
	const address = ipaddr.process(value);
	return activeRanges.some(([network, prefix]) => {
		if (address instanceof ipaddr.IPv4 && network instanceof ipaddr.IPv4) return address.match(network, prefix);
		if (address instanceof ipaddr.IPv6 && network instanceof ipaddr.IPv6) return address.match(network, prefix);
		return false;
	});
}
