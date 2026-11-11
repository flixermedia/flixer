import { describe, expect, it, vi } from "vitest";
import { executeDirectoryBind, executeDirectorySearch } from "./pluginDirectoryHost.js";

describe("directory authentication host call", () => {
	it("requires a specific approved LDAPS host and uses the submitted password", async () => {
		const bind = vi.fn().mockResolvedValue(undefined);
		const call = { id: "one", op: "ldap.bind", url: "ldaps://directory.example:636", bindDN: "uid=user,dc=example" };
		await expect(executeDirectoryBind(call, new Set(), "user-password", bind)).resolves.toEqual({ id: "one", ok: false, error: "permission_denied" });
		await expect(executeDirectoryBind(call, new Set(["network.ldaps.directory.example"]), "user-password", bind)).resolves.toEqual({ id: "one", ok: true, authenticated: true });
		expect(bind).toHaveBeenCalledWith(expect.any(URL), call.bindDN, "user-password", expect.any(AbortSignal));
		await expect(executeDirectoryBind({ ...call, url: "ldap://directory.example" }, new Set(["network.ldaps.directory.example"]), "user-password", bind)).resolves.toEqual({ id: "one", ok: false, error: "invalid_request" });
	});

	it("does not reveal directory errors or credentials", async () => {
		const bind = vi.fn().mockRejectedValue(new Error("user-password is private"));
		const result = await executeDirectoryBind({ id: "one", op: "ldap.bind", url: "ldaps://directory.example", bindDN: "uid=user" }, new Set(["network.ldaps.directory.example"]), "user-password", bind);
		expect(result).toEqual({ id: "one", ok: false, error: "authentication_failed" });
		expect(JSON.stringify(result)).not.toContain("user-password");
	});

	it("requires separate approved search and host permissions and bounds results", async () => {
		const call = { id: "search", op: "ldap.search", url: "ldaps://directory.example", bindDN: "cn=service", bindPassword: "service-secret", baseDN: "dc=example", filter: "(uid=alice)", attributes: ["uid"] };
		const search = vi.fn().mockResolvedValue([{ dn: "uid=alice,dc=example", uid: "alice" }]);
		await expect(executeDirectorySearch(call, new Set(["network.ldaps.directory.example"]), search)).resolves.toEqual({ id: "search", ok: false, error: "permission_denied" });
		const approved = new Set(["directory.search", "network.ldaps.directory.example"]);
		await expect(executeDirectorySearch(call, approved, search)).resolves.toEqual({ id: "search", ok: true, entries: [{ dn: "uid=alice,dc=example", uid: "alice" }] });
		search.mockResolvedValueOnce([{}, {}, {}]);
		await expect(executeDirectorySearch(call, approved, search)).resolves.toEqual({ id: "search", ok: false, error: "invalid_response" });
	});
});