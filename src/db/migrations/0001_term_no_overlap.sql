-- Hand-written — Drizzle has no native syntax for exclusion constraints.
-- See SPEC.md "People & positions": no two Term rows for the same
-- politicianId + chamberId should have overlapping [startDate, endDate)
-- ranges. NULL endDate means "currently serving" (open-ended), so it's
-- coalesced to 'infinity' rather than treated as an unknown/excluded
-- value — a bare `daterange(start_date, end_date)` returns NULL (and so
-- matches nothing) whenever either bound is NULL.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "terms" ADD CONSTRAINT "terms_no_overlap" EXCLUDE USING gist (
	"politician_id" WITH =,
	"chamber_id" WITH =,
	daterange("start_date", COALESCE("end_date", 'infinity'::date), '[)') WITH &&
);
