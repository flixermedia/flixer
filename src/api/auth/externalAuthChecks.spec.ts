import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { User } from "../../entities/user.entity.js";
import { AuthService } from "./authService.js";

describe("external primary authentication checks", () => {
	it("preserves disabled, payment, email and passkey requirements", async () => {
		const credentialRepository = { existsBy: vi.fn().mockResolvedValue(true) };
		const dataSource = { getRepository: vi.fn(() => credentialRepository) } as unknown as DataSource;
		const email = { isRequired: vi.fn().mockResolvedValue(true) };
		const payments = { isSignupPending: vi.fn().mockResolvedValue(false), issueSignupToken: vi.fn().mockReturnValue("payment-token") };
		const service = new AuthService(dataSource, email as never, {} as never, {} as never, payments as never);
		const user = { id: "user", disabledAt: new Date(), emailVerifiedAt: null, preferences: { passkeyRequired: true } } as unknown as User;
		await expect(service.completePrimaryAuthentication(user)).rejects.toThrow("disabled");
		user.disabledAt = null;
		payments.isSignupPending.mockResolvedValueOnce(true);
		await expect(service.completePrimaryAuthentication(user)).resolves.toEqual({ paymentRequired: true, token: "payment-token" });
		await expect(service.completePrimaryAuthentication(user)).rejects.toThrow("verify your email");
		user.emailVerifiedAt = new Date();
		vi.spyOn(service, "createPasskeyTicket").mockReturnValue("passkey-ticket");
		await expect(service.completePrimaryAuthentication(user)).resolves.toEqual({ passkeyRequired: true, ticket: "passkey-ticket" });
		user.preferences!.passkeyRequired = false;
		vi.spyOn(service, "issueAuthResult").mockResolvedValue({ accessToken: "session" } as never);
		await expect(service.completePrimaryAuthentication(user)).resolves.toEqual({ accessToken: "session" });
	});
});