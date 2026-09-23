import { and, eq } from "drizzle-orm";
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
}

/**
 * The dedup-sensitive path a JurisdictionAdapter sync goes through —
 * see SPEC.md "People & positions" on out-of-order polling: a Term/
 * VoteRecord/etc. can reference a politician the roster sync hasn't
 * produced a name for yet. Rather than block ingestion, this writes a
 * placeholder name (which is why `fullName` is required NOT NULL on
 * `politicians` but optional here) and overwrites it the moment a real
 * name syncs in for the same jurisdiction+externalId.
 */
export async function upsertPoliticianByExternalId(
  input: UpsertPoliticianByExternalIdInput,
): Promise<string> {
  const existing = await db
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

  if (existing[0]) {
    const isPlaceholder = existing[0].fullName === placeholderName(input.externalId);
    if (input.fullName && isPlaceholder) {
      await db
        .update(politicians)
        .set({ fullName: input.fullName, updatedAt: new Date() })
        .where(eq(politicians.id, existing[0].politicianId));
    }
    return existing[0].politicianId;
  }

  return db.transaction(async (tx) => {
    const [politician] = await tx
      .insert(politicians)
      .values({
        fullName: input.fullName ?? placeholderName(input.externalId),
        sourceItem: input.sourceItem,
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

/** Plain, JSON-serializable — see decision #5/#8. */
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
