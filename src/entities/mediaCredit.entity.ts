import { createHash } from "node:crypto";
import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * One person's credit on one item (actor, director, writer, artist, albumArtist, ...), so everything a person
 * worked on can be found with an index lookup. People are identified by `personKey`, their lower-cased name.
 */
@Entity("media_credits")
@Index("idx_media_credits_person", ["personKey", "role"])
export class MediaCredit {

	@PrimaryColumn({ name: "item_id", type: "uuid" })
	itemId!: string;

	@PrimaryColumn({ name: "person_key", type: "text" })
	personKey!: string;

	/** Public id of the person; see personIdOf. */
	@Index("idx_media_credits_person_id")
	@Column({ name: "person_id", type: "uuid" })
	personId!: string;

	@PrimaryColumn({ type: "text" })
	role!: string;

	@Column({ type: "text" })
	name!: string;

	/** Character played, or the crew job. */
	@Column({ type: "text", nullable: true })
	detail!: string | null;

	@Column({ type: "integer", default: 0 })
	position!: number;

	/** Photo URL from the metadata provider; only ever fetched through allowedPersonImage. */
	@Column({ type: "text", nullable: true })
	image!: string | null;
}

/** Same normalisation as the migration's backfill. */
export function personKeyOf(name: string): string {
	return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Stable id for a person: the md5 of their key formatted as a uuid, which Postgres computes identically with md5(key)::uuid. */
export function personIdOf(name: string): string {
	const hex = createHash("md5").update(personKeyOf(name)).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
