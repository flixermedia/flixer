import { BadRequest } from "@tsed/exceptions";
import { sanitizePageContent, type PublishedPage } from "../appearance/pageBuilderSchema.ts";

export interface RegistrationFieldValue { id: string; label: string; value: string }

export function validateRegistrationFields(input: unknown, published: PublishedPage | null | undefined): RegistrationFieldValue[] {
	if (input === undefined) return [];
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequest("Invalid registration fields.");
	const entries = Object.entries(input);
	if (entries.length > 10 || !published) throw new BadRequest("Invalid registration fields.");
	const blocks = sanitizePageContent(published, "login").blocks.filter((block) => block.type === "auth-custom");
	return entries.map(([id, value]) => {
		const field = blocks.find((block) => block.id === id);
		if (!field || typeof value !== "string" || value.length > 500) throw new BadRequest("Invalid registration fields.");
		return { id, label: field.text, value: value.trim() };
	});
}