import { createHash } from "node:crypto";

/** SHA-256 hex digest of a payload — the `content_hash` integrity/dedup key. */
export function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Canonical form of a source/canonical URL for exact-dedup keys: http(s)
 * URLs get a lowercased scheme/host, no default port, and no fragment
 * (all via `URL`). Query strings are left alone — parameter order can be
 * meaningful, and sorting it would risk merging genuinely different
 * resources. Anything that isn't an http(s) URL (a manual upload's file
 * reference, for instance) passes through trimmed, not rejected.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;
  url.hash = "";
  return url.toString();
}
