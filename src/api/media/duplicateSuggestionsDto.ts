import { Integer, Maximum, Minimum, Property } from "@tsed/schema";

export class DuplicateSuggestionsQuery {
	@Property()
	@Integer()
	@Minimum(1)
	@Maximum(1000000)
	page?: number;

	@Property()
	@Integer()
	@Minimum(1)
	@Maximum(100)
	size?: number;
}

export interface DuplicateSuggestionItem {
	id: string;
	title: string;
	year: number | null;
	path: string;
}

export interface DuplicateSuggestion {
	libraryId: string;
	type: string;
	kind: "providerId" | "fileHash";
	provider: string;
	providerId: string;
	itemCount: number;
	itemsTruncated: boolean;
	items: DuplicateSuggestionItem[];
}

export interface DuplicateSuggestionsPage {
	items: DuplicateSuggestion[];
	total: number;
	page: number;
	size: number;
}