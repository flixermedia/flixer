import { describe, expect, it, vi } from "vitest";
import { RepairInvitationUsages1798300000037 } from "./repairInvitationUsages1798300000037.js";

describe("RepairInvitationUsages1798300000037", () => {
	it("adds missing pending_credentials and user_disabled_at columns idempotently", async () => {
		const query = vi.fn();
		await new RepairInvitationUsages1798300000037().up({ query } as never);
		expect(query.mock.calls[0]?.[0]).toContain('ADD COLUMN IF NOT EXISTS "pending_credentials" text');
		expect(query.mock.calls[1]?.[0]).toContain('ADD COLUMN IF NOT EXISTS "user_disabled_at" timestamptz');
	});

	it("leaves columns owned by the initial invites migration intact on rollback", async () => {
		const query = vi.fn();
		await new RepairInvitationUsages1798300000037().down();
		expect(query).not.toHaveBeenCalled();
	});
});
