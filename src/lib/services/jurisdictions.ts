import { db } from "@/db";
import { chambers, jurisdictions } from "@/db/schema";

export interface UpsertJurisdictionInput {
  slug: string;
  name: string;
  level: "federal" | "state" | "local" | "other";
  parentJurisdictionId?: string;
}

export async function upsertJurisdiction(input: UpsertJurisdictionInput): Promise<string> {
  const [row] = await db
    .insert(jurisdictions)
    .values(input)
    .onConflictDoUpdate({
      target: jurisdictions.slug,
      set: {
        name: input.name,
        level: input.level,
        // Only touched when supplied — an omitted parent means "not
        // specified this time," not "clear it."
        ...(input.parentJurisdictionId !== undefined && {
          parentJurisdictionId: input.parentJurisdictionId,
        }),
      },
    })
    .returning({ id: jurisdictions.id });

  return row.id;
}

export interface UpsertChamberInput {
  jurisdictionId: string;
  slug: string;
  name: string;
}

// A single ON CONFLICT statement, not select-then-insert: two overlapping
// polls both seeing "no chamber yet" would otherwise race into a unique
// violation instead of deduping.
export async function upsertChamber(input: UpsertChamberInput): Promise<string> {
  const [row] = await db
    .insert(chambers)
    .values(input)
    .onConflictDoUpdate({
      target: [chambers.jurisdictionId, chambers.slug],
      set: { name: input.name },
    })
    .returning({ id: chambers.id });

  return row.id;
}

