import { MaxLength, Property, Required } from "@tsed/schema";

export class CreateIssueReportRequest {
	@Required()
	@MaxLength(200)
	title!: string;

	@Required()
	@MaxLength(60)
	category!: string;

	@Required()
	@MaxLength(5000)
	description!: string;

	@Property()
	@MaxLength(36)
	mediaItemId?: string;
}

export class UpdateIssueReportStatusRequest {
	@Required()
	@MaxLength(16)
	status!: string;
}

export class AddIssueReportUpdateRequest {
	@Required()
	@MaxLength(2000)
	body!: string;

	@Property()
	isInternal?: boolean;
}

export class SetIssueReportChatRequest {
	@Required()
	open!: boolean;
}
