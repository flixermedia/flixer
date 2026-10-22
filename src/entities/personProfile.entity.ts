import { Column, Entity, PrimaryColumn } from "typeorm";

/** A person's biography, fetched once through flixer-indexer and kept so the person page never waits on it again. */
@Entity("person_profiles")
export class PersonProfile {

	/** See personIdOf. */
	@PrimaryColumn({ name: "person_id", type: "uuid" })
	personId!: string;

	/** One-line description, e.g. "American singer-songwriter". */
	@Column({ type: "text", nullable: true })
	description!: string | null;

	@Column({ type: "text", nullable: true })
	biography!: string | null;

	@Column({ type: "text", nullable: true })
	source!: string | null;

	@Column({ name: "source_url", type: "text", nullable: true })
	sourceUrl!: string | null;

	/** Photo URL from the source; only ever fetched through allowedPersonImage. */
	@Column({ type: "text", nullable: true })
	image!: string | null;

	/** When a lookup last ran, including lookups that found nothing, so misses are retried only occasionally. */
	@Column({ name: "fetched_at", type: "timestamptz" })
	fetchedAt!: Date;
}
