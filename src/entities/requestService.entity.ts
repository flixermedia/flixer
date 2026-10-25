import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

export const REQUEST_SERVICE_KINDS = ["sonarr", "radarr", "lidarr"] as const;
export type RequestServiceKind = (typeof REQUEST_SERVICE_KINDS)[number];

/** A Sonarr, Radarr or Lidarr instance that approved requests are sent to. */
@Entity("request_services")
export class RequestService {

	@PrimaryColumn("uuid")
	id!: string;

	@Column({ type: "varchar", length: 16 })
	kind!: RequestServiceKind;

	@Column({ type: "varchar", length: 100 })
	name!: string;

	@Column({ type: "text" })
	url!: string;

	@Column({ name: "api_key", type: "text" })
	apiKey!: string;

	/** The instance used for its kind when a request does not pick one. */
	@Column({ name: "is_default", type: "boolean", default: false })
	isDefault!: boolean;

	@Column({ type: "boolean", default: true })
	enabled!: boolean;

	/** The Flixer library this server fills; requests are only sent to servers linked to a library. */
	@Column({ name: "library_id", type: "uuid", nullable: true })
	libraryId!: string | null;

	@Column({ name: "root_folder", type: "text" })
	rootFolder!: string;

	@Column({ name: "quality_profile_id", type: "integer" })
	qualityProfileId!: number;

	@Column({ name: "metadata_profile_id", type: "integer", nullable: true })
	metadataProfileId!: number | null;

	@Column({ name: "language_profile_id", type: "integer", nullable: true })
	languageProfileId!: number | null;

	@Column({ name: "minimum_availability", type: "varchar", length: 16, nullable: true })
	minimumAvailability!: string | null;

	@Column({ name: "season_folders", type: "boolean", default: true })
	seasonFolders!: boolean;

	@Column({ type: "jsonb", default: () => "'[]'" })
	tags!: number[];

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt!: Date;
}
