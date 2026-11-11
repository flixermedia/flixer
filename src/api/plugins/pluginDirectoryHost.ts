import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Client } from "ldapts";
import type { HostCall, HostResult } from "./pluginHostCalls.js";

export type DirectoryBind = (url: URL, bindDN: string, password: string, signal: AbortSignal) => Promise<void>;
export type DirectorySearch = (url: URL, bindDN: string, password: string, baseDN: string, filter: string, attributes: string[], signal: AbortSignal) => Promise<Array<Record<string, unknown>>>;

async function directoryClient(url: URL, signal: AbortSignal): Promise<Client> {
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const addresses = await lookup(hostname, { all: true, verbatim: true });
	if (signal.aborted) throw new Error("Directory request timed out.");
	if (!addresses.length) throw new Error("Directory address unavailable.");
	const address = addresses[0].address;
	const host = isIP(address) === 6 ? `[${address}]` : address;
	return new Client({ url: `ldaps://${host}:${url.port || "636"}`, timeout: 4000, connectTimeout: 4000, tlsOptions: { servername: hostname, minVersion: "TLSv1.2", rejectUnauthorized: true } });
}

const bindDirectory: DirectoryBind = async (url, bindDN, password, signal) => {
	const client = await directoryClient(url, signal);
	try {
		await client.bind(bindDN, password);
	} finally {
		await client.unbind().catch(() => undefined);
	}
};

const searchDirectory: DirectorySearch = async (url, bindDN, password, baseDN, filter, attributes, signal) => {
	const client = await directoryClient(url, signal);
	try {
		await client.bind(bindDN, password);
		if (signal.aborted) throw new Error("Directory request timed out.");
		const result = await client.search(baseDN, { scope: "sub", filter, attributes, sizeLimit: 2, timeLimit: 3 });
		return result.searchEntries.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key === "dn" || attributes.includes(key)).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 1024) : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 10).map((item) => item.slice(0, 1024)) : null])));
	} finally {
		await client.unbind().catch(() => undefined);
	}
};

function directoryUrl(value: unknown, approved: ReadonlySet<string>): URL | null {
	if (typeof value !== "string" || value.length > 2048) return null;
	let url: URL;
	try { url = new URL(value); } catch { return null; }
	if (url.protocol !== "ldaps:" || url.username || url.password || url.pathname !== "" || url.search || url.hash || !url.hostname || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))) return null;
	return approved.has(`network.ldaps.${url.hostname.toLowerCase()}`) ? url : null;
}

export async function executeDirectoryBind(call: HostCall, approved: ReadonlySet<string>, password: unknown, bind: DirectoryBind = bindDirectory): Promise<HostResult> {
	if (call.op !== "ldap.bind" || typeof call.url !== "string" || call.url.length > 2048 || typeof call.bindDN !== "string" || !call.bindDN.trim() || call.bindDN.length > 1024 || /[\u0000-\u001f]/.test(call.bindDN) || typeof password !== "string" || !password || password.length > 1024) return { id: call.id, ok: false, error: "invalid_request" };
	let parsed: URL;
	try { parsed = new URL(call.url); } catch { return { id: call.id, ok: false, error: "invalid_request" }; }
	if (parsed.protocol !== "ldaps:") return { id: call.id, ok: false, error: "invalid_request" };
	const url = directoryUrl(call.url, approved);
	if (!url) return { id: call.id, ok: false, error: "permission_denied" };
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);
	const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Directory request timed out.")), { once: true }));
	try {
		await Promise.race([bind(url, call.bindDN, password, controller.signal), aborted]);
		return { id: call.id, ok: true, authenticated: true };
	} catch {
		return { id: call.id, ok: false, error: "authentication_failed" };
	} finally {
		clearTimeout(timeout);
	}
}

export async function executeDirectorySearch(call: HostCall, approved: ReadonlySet<string>, search: DirectorySearch = searchDirectory): Promise<HostResult> {
	if (call.op !== "ldap.search" || !approved.has("directory.search")) return { id: call.id, ok: false, error: "permission_denied" };
	const url = directoryUrl(call.url, approved);
	if (!url) return { id: call.id, ok: false, error: "permission_denied" };
	if (typeof call.bindDN !== "string" || !call.bindDN.trim() || call.bindDN.length > 1024 || typeof call.bindPassword !== "string" || !call.bindPassword || call.bindPassword.length > 1024 || typeof call.baseDN !== "string" || !call.baseDN.trim() || call.baseDN.length > 1024 || typeof call.filter !== "string" || !call.filter || call.filter.length > 2048 || !Array.isArray(call.attributes) || call.attributes.length < 1 || call.attributes.length > 8 || !call.attributes.every((attribute) => typeof attribute === "string" && /^[A-Za-z][A-Za-z0-9;.-]{0,63}$/.test(attribute))) return { id: call.id, ok: false, error: "invalid_request" };
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);
	const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Directory request timed out.")), { once: true }));
	try {
		const entries = await Promise.race([search(url, call.bindDN, call.bindPassword, call.baseDN, call.filter, call.attributes as string[], controller.signal), aborted]);
		if (entries.length > 2 || Buffer.byteLength(JSON.stringify(entries)) > 16 * 1024) return { id: call.id, ok: false, error: "invalid_response" };
		return { id: call.id, ok: true, entries };
	} catch {
		return { id: call.id, ok: false, error: "request_failed" };
	} finally {
		clearTimeout(timeout);
	}
}