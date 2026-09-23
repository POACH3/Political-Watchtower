import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chambers, jurisdictions } from "@/db/schema";

export interface UpsertJurisdictionInput {
  slug: string;
  name: string;
  level: "federal" | "state" | "local";
  parentJurisdictionId?: string;
}

export async function upsertJurisdiction(input: UpsertJurisdictionInput): Promise<string> {
  const [row] = await db
    .insert(jurisdictions)
    .values(input)
    .onConflictDoUpdate({
      target: jurisdictions.slug,
      set: { name: input.name, level: input.level },
    })
    .returning({ id: jurisdictions.id });

  return row.id;
}

export interface UpsertChamberInput {
  jurisdictionId: string;
  slug: string;
  name: string;
}

export async function upsertChamber(input: UpsertChamberInput): Promise<string> {
  const existing = await db
    .select({ id: chambers.id })
    .from(chambers)
    .where(and(eq(chambers.jurisdictionId, input.jurisdictionId), eq(chambers.slug, input.slug)))
    .limit(1);

  if (existing[0]) return existing[0].id;

  const [row] = await db.insert(chambers).values(input).returning({ id: chambers.id });
  return row.id;
}
