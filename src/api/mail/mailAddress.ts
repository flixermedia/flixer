const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;

/** Lower-cases and validates a DNS name (no trailing dot, at least two labels). Returns null when invalid. */
export function normalizeDomain(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const domain = value.trim().toLowerCase().replace(/\.$/, "");
	if (domain.length < 3 || domain.length > 253) return null;
	const labels = domain.split(".");
	if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
	if (/^\d+$/.test(labels[labels.length - 1])) return null;
	return domain;
}

export function normalizeLocalPart(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const local = value.trim().toLowerCase();
	if (local.length < 1 || local.length > 64 || !LOCAL_PART.test(local) || local.includes("..")) return null;
	return local;
}

/** Parses a plain address (no display name). Returns null for anything that isn't a conservative mailbox address. */
export function parseAddress(value: unknown): { local: string; domain: string; address: string } | null {
	if (typeof value !== "string" || value.length > 320) return null;
	const at = value.lastIndexOf("@");
	if (at < 1) return null;
	const local = normalizeLocalPart(value.slice(0, at));
	const domain = normalizeDomain(value.slice(at + 1));
	if (!local || !domain) return null;
	return { local, domain, address: `${local}@${domain}` };
}

/** True when `host` is `domain` itself or, when subdomains are allowed, any subdomain of it. */
export function domainCovers(domain: string, allowSubdomains: boolean, host: string): boolean {
	return host === domain || (allowSubdomains && host.endsWith(`.${domain}`));
}

/** Removes characters that could inject headers or break out of a header value. */
export function headerSafe(value: string, maxLength = 998): string {
	return value.replace(/[\r\n\0]+/g, " ").trim().slice(0, maxLength);
}
