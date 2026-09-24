import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { politicianExternalIds, politicians } from "@/db/schema";

function placeholderName(externalId: string): string {
  return `Unnamed (external_id: ${externalId})`;
}

export interface UpsertPoliticianByExternalIdInput {
  jurisdictionId: string;
  externalId: string;
  sourceItem: string;
  fullName?: string;
  // Optional profile fields — refreshed on every sync when supplied, never
  // blanked when omitted (an omitted field means "this response didn't
  // include it," not "clear it").
  displayName?: string;
  photoUrl?: string;
  bioText?: string;
  birthDate?: string; // ISO date
}

/**
 * The dedup-sensitive path a JurisdictionAdapter sync goes through —
 * see SPEC.md "People & positions" on out-of-order polling: a Term/
 * VoteRecord/etc. can reference a politician the roster sync hasn't
 * produced a name for yet. Rather than block ingestion, this writes a
 * placeholder name (which is why `fullName` is required NOT NULL on
 * `politicians` but optional here) and overwrites it the moment a real
 * name syncs in for the same jurisdiction+externalId.
 *
 * Concurrency: a select-then-insert here would let two overlapping polls
 * both see "no such politician" and race into a unique violation (or,
 * worse, an orphaned `politicians` row if the external-id insert is what
 * loses). A transaction-scoped advisory lock keyed on
 * jurisdiction+externalId serializes them instead, so the loser simply
 * finds the winner's row.
 */
export async function upsertPoliticianByExternalId(
  input: UpsertPoliticianByExternalIdInput,
): Promise<string> {
  const lockKey = `${input.jurisdictionId}:${input.externalId}`;
  const profileFields = {
    ...(input.displayName !== undefined && { displayName: input.displayName }),
    ...(input.photoUrl !== undefined && { photoUrl: input.photoUrl }),
    ...(input.bioText !== undefined && { bioText: input.bioText }),
    ...(input.birthDate !== undefined && { birthDate: input.birthDate }),
  };

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [existing] = await tx
      .select({ politicianId: politicianExternalIds.politicianId, fullName: politicians.fullName })
      .from(politicianExternalIds)
      .innerJoin(politicians, eq(politicians.id, politicianExternalIds.politicianId))
      .where(
        and(
          eq(politicianExternalIds.jurisdictionId, input.jurisdictionId),
          eq(politicianExternalIds.externalId, input.externalId),
        ),
      )
      .limit(1);

    if (existing) {
      // A real name only replaces the placeholder, never another real
      // name — a later sync disagreeing with an earlier one is a
      // reviewable event, not something to overwrite silently.
      const isPlaceholder = existing.fullName === placeholderName(input.externalId);
      const set = {
        ...profileFields,
        ...(input.fullName && isPlaceholder && { fullName: input.fullName }),
      };
      // No manual updatedAt here — a BEFORE UPDATE trigger keeps it
      // current for every write path (see _shared.ts).
      if (Object.keys(set).length > 0) {
        await tx.update(politicians).set(set).where(eq(politicians.id, existing.politicianId));
      }
      return existing.politicianId;
    }

    const [politician] = await tx
      .insert(politicians)
      .values({
        fullName: input.fullName ?? placeholderName(input.externalId),
        sourceItem: input.sourceItem,
        ...profileFields,
      })
      .returning({ id: politicians.id });

    await tx.insert(politicianExternalIds).values({
      politicianId: politician.id,
      jurisdictionId: input.jurisdictionId,
      externalId: input.externalId,
    });

    return politician.id;
  });
}

export interface PoliticianProfile {
  id: string;
  fullName: string;
  displayName: string | null;
  photoUrl: string | null;
  bioText: string | null;
  birthDate: string | null;
}

/** Plain, JSON-serializable — see decision #4. */
export async function getPoliticianProfile(id: string): Promise<PoliticianProfile | null> {
  const [row] = await db
    .select({
      id: politicians.id,
      fullName: politicians.fullName,
      displayName: politicians.displayName,
      photoUrl: politicians.photoUrl,
      bioText: politicians.bioText,
      birthDate: politicians.birthDate,
    })
    .from(politicians)
    .where(eq(politicians.id, id))
    .limit(1);

  return row ?? null;
}
