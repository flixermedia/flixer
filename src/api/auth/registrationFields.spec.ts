import { describe, expect, it, vi } from "vitest";
import { validateRegistrationFields } from "./registrationFields.js";
import { deserialize } from "@tsed/json-mapper";
import { getJsonSchema } from "@tsed/schema";
import { RegisterRequest } from "./registerRequest.js";
import { AuthService } from "./authService.js";
import { User } from "../../entities/user.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";

const fields = ["username", "password", "email", "submit", "switch"].map((field) => ({ id: field, type: "auth-field" as const, field: field as "username" | "password" | "email" | "submit" | "switch", text: "", image: null }));
const published = { title: "Login", slug: "login", layout: "free" as const, blocks: [...fields, { id: "custom-id", type: "auth-custom" as const, text: "Favorite genre", image: null }] };

describe("registration profile metadata", () => {
	it("accepts only configured custom fields and uses server-controlled labels", () => {
		expect(validateRegistrationFields({ "custom-id": " Drama " }, published)).toEqual([{ id: "custom-id", label: "Favorite genre", value: "Drama" }]);
		expect(validateRegistrationFields(undefined, undefined)).toEqual([]);
	});
	it("rejects unknown fields, oversized values and unpublished configurations", () => {
		expect(() => validateRegistrationFields({ password: "secret" }, published)).toThrow();
		expect(() => validateRegistrationFields({ "custom-id": "x".repeat(501) }, published)).toThrow();
		expect(() => validateRegistrationFields({ "custom-id": "value" }, null)).toThrow();
	});
	it("keeps metadata in the registration DTO", () => {
		const request = deserialize({ username: "user", password: "password123", email: "user@example.com", customFields: { "custom-id": "Drama" } }, { type: RegisterRequest });
		expect(request.customFields).toEqual({ "custom-id": "Drama" });
		expect(getJsonSchema(RegisterRequest)).toMatchObject({ properties: { customFields: { type: "object" } } });
	});
	it("stores accepted fields with the new account and rejects unknown fields before saving", async () => {
		const users = { create: vi.fn((value) => value), count: vi.fn(async () => 1), save: vi.fn(async () => undefined) };
		const settings = { findOneBy: vi.fn(async ({ key }: { key: string }) => key === "registration_enabled" ? { value: true } : { value: { published } }) };
		const preferences = { save: vi.fn(async () => undefined) };
		const getRepository = (entity: unknown) => entity === User ? users : entity === Setting ? settings : entity === UserPreference ? preferences : null;
		const source = { getRepository, transaction: async (run: (manager: unknown) => Promise<unknown>) => run({ getRepository, query: async () => undefined }) };
		const service = new AuthService(source as never, { isRequired: async () => false } as never, {} as never, {} as never, { cardRequiredForSignup: async () => false } as never);
		const internal = service as unknown as { getTokenSecret: () => string; createAuthResult: () => Promise<unknown> };
		vi.spyOn(internal, "getTokenSecret").mockReturnValue("test-secret");
		vi.spyOn(internal, "createAuthResult").mockResolvedValue({ accessToken: "test" });
		vi.spyOn(service, "hashPassword").mockResolvedValue("hash");
		await service.register("username", "password123", "user@example.com", "User", undefined, { "custom-id": "Drama" });
		expect(preferences.save).toHaveBeenCalledWith(expect.objectContaining({ data: { registrationFields: [{ id: "custom-id", label: "Favorite genre", value: "Drama" }] } }));
		users.save.mockClear();
		await expect(service.register("other", "password123", "other@example.com", "Other", undefined, { password: "secret" })).rejects.toThrow("Invalid registration fields.");
		expect(users.save).not.toHaveBeenCalled();
	});
});