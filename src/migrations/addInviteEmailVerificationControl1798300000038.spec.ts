import { describe, expect, it, vi } from "vitest";
import { AddInviteEmailVerificationControl1798300000038 } from "./addInviteEmailVerificationControl1798300000038.js";

describe("AddInviteEmailVerificationControl1798300000038", () => {
	it("adds skip_email_verification and widens invitation_usages.status", async () => {
		const query = vi.fn();
		await new AddInviteEmailVerificationControl1798300000038().up({ query } as never);
		expect(query.mock.calls[0]?.[0]).toContain('ADD COLUMN IF NOT EXISTS "skip_email_verification" boolean NOT NULL DEFAULT false');
		expect(query.mock.calls[1]?.[0]).toContain('ALTER COLUMN "status" TYPE varchar(32)');
	});

	it("drops skip_email_verification on rollback", async () => {
		const query = vi.fn();
		await new AddInviteEmailVerificationControl1798300000038().down({ query } as never);
		expect(query.mock.calls[0]?.[0]).toContain('DROP COLUMN IF EXISTS "skip_email_verification"');
	});
});
