-- narrative/oversight schema — see SPEC.md "Aggregator output
-- schema" and "Claim-preserving content model".
--
-- Everything below is third-party content about politicians (news, 
-- social posts, the claims/promises extracted from them) — attributed 
-- and status-tagged, never asserted as true. 
-- Tables are grouped into four sections below; foreign keys are 
-- added in one pass afterward (grouped the same way) so a
-- table in one section can safely reference a table from a later
-- section without any ordering risk.

--> statement-breakpoint
-- ============================================================
-- News & social
-- Articles and social posts, their raw sources, duplicate/near-duplicate
-- linking, and which politicians they mention.
-- ============================================================

--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('news', 'x', 'facebook', 'instagram', 'rss', 'other');

--> statement-breakpoint
CREATE TYPE "public"."news_item_relation_type" AS ENUM('exact_duplicate', 'possible_near_duplicate');

--> statement-breakpoint
CREATE TYPE "public"."mention_confidence" AS ENUM('confirmed', 'inferred');

--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"canonical_url" text NOT NULL,
	"published_at" timestamp with time zone,
	"content_hash" text NOT NULL,
	"author_name" text,
	"author_handle" text,
	"headline_or_text" text NOT NULL,
	"excerpt" text,
	"is_suppressed" boolean DEFAULT false NOT NULL,
	"suppressed_at" timestamp with time zone,
	"suppression_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "news_item_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"news_item_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_item_sources_news_item_id_source_item_id_unique" UNIQUE("news_item_id","source_item_id")
);

--> statement-breakpoint
CREATE TABLE "news_item_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"news_item_a_id" uuid NOT NULL,
	"news_item_b_id" uuid NOT NULL,
	"relation_type" "news_item_relation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_item_relations_news_item_a_id_news_item_b_id_relation_type_unique" UNIQUE("news_item_a_id","news_item_b_id","relation_type"),
	CONSTRAINT "news_item_relations_canonical_order" CHECK ("news_item_relations"."news_item_a_id" < "news_item_relations"."news_item_b_id")
);

--> statement-breakpoint
CREATE TABLE "news_item_politicians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"news_item_id" uuid NOT NULL,
	"politician_id" uuid NOT NULL,
	"confidence" "mention_confidence" NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_item_politicians_news_item_id_politician_id_unique" UNIQUE("news_item_id","politician_id")
);

--> statement-breakpoint
-- ============================================================
-- Claims
-- The defamation-resistant core: an allegation carrying a
-- verification_status (never a truth score), who it's about, how a
-- politician responded, and links between claims restating the same
-- underlying thing. claim_sources_one_primary_idx enforces at most one
-- 'primary' source per claim; the hand-written trigger after the
-- Promises section below enforces at least one.
-- ============================================================

--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('UNVERIFIED_CLAIM', 'SUPPORTED_BY_PRIMARY_SOURCE', 'CORROBORATED', 'CONTRADICTED', 'DISPUTED_BY_SOURCE', 'OPINION', 'SATIRE', 'UNKNOWN');

--> statement-breakpoint
CREATE TYPE "public"."verification_set_by" AS ENUM('processor', 'admin');

--> statement-breakpoint
CREATE TYPE "public"."claim_source_relation" AS ENUM('primary', 'supporting', 'contradicting');

--> statement-breakpoint
CREATE TYPE "public"."target_confidence" AS ENUM('confirmed', 'inferred');

--> statement-breakpoint
CREATE TYPE "public"."claim_response_stance" AS ENUM('denies', 'confirms', 'clarifies');

--> statement-breakpoint
CREATE TYPE "public"."claim_relation_type" AS ENUM('possible_restatement');

--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"news_item_id" uuid NOT NULL,
	"exact_text" text NOT NULL,
	"normalized_claim" text,
	"claimant_text" text NOT NULL,
	"claimant_politician_id" uuid,
	"publication_timestamp" timestamp with time zone,
	"retrieved_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"verification_status" "verification_status" DEFAULT 'UNVERIFIED_CLAIM' NOT NULL,
	"verification_set_by" "verification_set_by" DEFAULT 'processor' NOT NULL,
	"verification_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verification_locked" boolean DEFAULT false NOT NULL,
	"is_suppressed" boolean DEFAULT false NOT NULL,
	"suppressed_at" timestamp with time zone,
	"suppression_reason" text,
	"model_version" text,
	"generated_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "claim_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"relation" "claim_source_relation" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_sources_claim_id_source_item_id_unique" UNIQUE("claim_id","source_item_id")
);

--> statement-breakpoint
CREATE UNIQUE INDEX "claim_sources_one_primary_idx" ON "claim_sources" USING btree ("claim_id") WHERE "claim_sources"."relation" = 'primary';

--> statement-breakpoint
CREATE TABLE "claim_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"politician_id" uuid NOT NULL,
	"confidence" "target_confidence" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_targets_claim_id_politician_id_unique" UNIQUE("claim_id","politician_id")
);

--> statement-breakpoint
CREATE TABLE "claim_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"response_news_item_id" uuid,
	"response_claim_id" uuid,
	"stance" "claim_response_stance" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_responses_claim_id_response_news_item_id_response_claim_id_unique" UNIQUE("claim_id","response_news_item_id","response_claim_id"),
	CONSTRAINT "claim_responses_exactly_one_target" CHECK (num_nonnulls("claim_responses"."response_news_item_id", "claim_responses"."response_claim_id") = 1)
);

--> statement-breakpoint
CREATE TABLE "claim_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_a_id" uuid NOT NULL,
	"claim_b_id" uuid NOT NULL,
	"relation_type" "claim_relation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_relations_claim_a_id_claim_b_id_relation_type_unique" UNIQUE("claim_a_id","claim_b_id","relation_type"),
	CONSTRAINT "claim_relations_canonical_order" CHECK ("claim_relations"."claim_a_id" < "claim_relations"."claim_b_id")
);

--> statement-breakpoint
-- ============================================================
-- Promises & priorities
-- Campaign commitments, their sourcing (same primary-source pattern as
-- Claims), and what fulfillment tracking is based on.
-- ============================================================

--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('not_yet_due', 'in_progress', 'fulfilled', 'broken', 'partially_fulfilled', 'stalled');

--> statement-breakpoint
CREATE TYPE "public"."promise_source_relation" AS ENUM('primary', 'supporting');

--> statement-breakpoint
CREATE TYPE "public"."promise_relation_type" AS ENUM('possible_restatement');

--> statement-breakpoint
CREATE TYPE "public"."promise_evidence_supports" AS ENUM('fulfillment', 'non_fulfillment', 'context');

--> statement-breakpoint
CREATE TABLE "politician_priority_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"politician_id" uuid NOT NULL,
	"issue_area_id" uuid NOT NULL,
	"source_item" uuid NOT NULL,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politician_priority_issues_politician_id_issue_area_id_unique" UNIQUE("politician_id","issue_area_id")
);

--> statement-breakpoint
CREATE TABLE "promises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"politician_id" uuid NOT NULL,
	"exact_text" text NOT NULL,
	"issue_area_id" uuid,
	"date_made" date,
	"target_date" date,
	"fulfillment_status" "fulfillment_status" DEFAULT 'not_yet_due' NOT NULL,
	"fulfillment_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "promise_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promise_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"relation" "promise_source_relation" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promise_sources_promise_id_source_item_id_unique" UNIQUE("promise_id","source_item_id")
);

--> statement-breakpoint
CREATE UNIQUE INDEX "promise_sources_one_primary_idx" ON "promise_sources" USING btree ("promise_id") WHERE "promise_sources"."relation" = 'primary';

--> statement-breakpoint
CREATE TABLE "promise_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promise_a_id" uuid NOT NULL,
	"promise_b_id" uuid NOT NULL,
	"relation_type" "promise_relation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promise_relations_promise_a_id_promise_b_id_relation_type_unique" UNIQUE("promise_a_id","promise_b_id","relation_type"),
	CONSTRAINT "promise_relations_canonical_order" CHECK ("promise_relations"."promise_a_id" < "promise_relations"."promise_b_id")
);

--> statement-breakpoint
CREATE TABLE "promise_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promise_id" uuid NOT NULL,
	"bill_id" uuid,
	"vote_id" uuid,
	"news_item_id" uuid,
	"claim_id" uuid,
	"supports" "promise_evidence_supports" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promise_evidence_promise_id_bill_id_vote_id_news_item_id_claim_id_unique" UNIQUE("promise_id","bill_id","vote_id","news_item_id","claim_id"),
	CONSTRAINT "promise_evidence_exactly_one_target" CHECK (num_nonnulls("promise_evidence"."bill_id", "promise_evidence"."vote_id", "promise_evidence"."news_item_id", "promise_evidence"."claim_id") = 1)
);

--> statement-breakpoint
-- Hand-written — Drizzle has no native syntax for triggers, and a plain
-- FK/CHECK on `claims`/`promises` can't express "must have at least one
-- row in another table." See SPEC.md "Validation & acceptance criteria":
-- "Every Claim has exactly one ClaimSource with relation: 'primary'" —
-- checking for a primary source specifically, not just "has a source of
-- any relation": a Claim with only a 'contradicting' source and no
-- primary attribution would defeat the "where did this come from" gap
-- the provenance design exists to close.
--
-- DEFERRABLE INITIALLY DEFERRED so the check runs at COMMIT, not at the
-- claims/promises INSERT itself — the service layer inserts the parent
-- row and its 'primary' ClaimSource/PromiseSource row in the same
-- transaction, in either order; an immediate trigger would reject the
-- parent insert before the source row exists yet.
--
-- One function is shared across two different trigger tables (claims
-- and claim_sources), so it uses TG_TABLE_NAME to disambiguate what NEW/
-- OLD mean in each context — both tables have their own `id` column, so
-- a naive COALESCE(NEW.id, OLD.claim_id) would silently resolve to the
-- wrong value when fired from claim_sources (NEW.id there is the
-- claim_sources row's own id, not the claim being checked).
--
-- Covers INSERT (of the parent), and DELETE/UPDATE-of-claim_id-or-
-- relation (of the source) — so a source can't be re-parented, deleted,
-- or demoted from 'primary' to 'supporting' out from under an existing
-- claim/promise afterward with nothing noticing. Not a designed
-- operation in this app (SPEC's retraction design is soft suppression,
-- never DELETE), but the point of a DB-level backstop is to catch what
-- the app *shouldn't* do, not just what it's expected to do. Known
-- residual gap, not fixed here: TRUNCATE doesn't fire row triggers at
-- all — acceptable since TRUNCATE isn't a normal app operation, mainly
-- relevant to test fixtures resetting state.
--
-- SET search_path pinned on both functions so a session that shadows
-- claim_sources/promise_sources via a temp schema can't defeat the
-- check; RAISE EXCEPTION carries a distinct ERRCODE so the service layer
-- can distinguish this from an arbitrary plpgsql error rather than
-- pattern-matching the message text.

CREATE OR REPLACE FUNCTION check_claim_has_source() RETURNS trigger AS $$
DECLARE
	target_claim_id uuid;
BEGIN
	IF TG_TABLE_NAME = 'claims' THEN
		target_claim_id := NEW.id;
	ELSE
		-- Fired from claim_sources (DELETE, or UPDATE OF claim_id/relation)
		-- — OLD is what's being removed/changed away from, which is the
		-- claim that might now be left without a primary source.
		target_claim_id := OLD.claim_id;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM claim_sources
		WHERE claim_id = target_claim_id AND relation = 'primary'
	) THEN
		RAISE EXCEPTION 'Claim % has no primary ClaimSource row', target_claim_id
			USING ERRCODE = 'PW001';
	END IF;
	RETURN NULL; -- ignored for AFTER triggers
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE CONSTRAINT TRIGGER claims_require_source
AFTER INSERT ON claims
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_claim_has_source();

CREATE CONSTRAINT TRIGGER claim_sources_require_primary_on_change
AFTER DELETE OR UPDATE OF claim_id, relation ON claim_sources
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_claim_has_source();

CREATE OR REPLACE FUNCTION check_promise_has_source() RETURNS trigger AS $$
DECLARE
	target_promise_id uuid;
BEGIN
	IF TG_TABLE_NAME = 'promises' THEN
		target_promise_id := NEW.id;
	ELSE
		target_promise_id := OLD.promise_id;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM promise_sources
		WHERE promise_id = target_promise_id AND relation = 'primary'
	) THEN
		RAISE EXCEPTION 'Promise % has no primary PromiseSource row', target_promise_id
			USING ERRCODE = 'PW002';
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE CONSTRAINT TRIGGER promises_require_source
AFTER INSERT ON promises
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_promise_has_source();

CREATE CONSTRAINT TRIGGER promise_sources_require_primary_on_change
AFTER DELETE OR UPDATE OF promise_id, relation ON promise_sources
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_promise_has_source();

--> statement-breakpoint
-- ============================================================
-- Review & audit
-- The human-correction audit trail, and what stops a suppressed item
-- from being silently re-created on the next crawl. Not FK'd to their
-- targets — review_actions spans five different target tables and
-- suppression_rules matches by pattern, not by row.
-- ============================================================

--> statement-breakpoint
CREATE TYPE "public"."review_target_type" AS ENUM('claim', 'promise', 'news_item_politician', 'politician_alias', 'collected_item');

--> statement-breakpoint
CREATE TYPE "public"."suppression_rule_type" AS ENUM('url_pattern', 'content_hash', 'claim_text_pattern');

--> statement-breakpoint
CREATE TABLE "review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "review_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"field_changed" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX "review_actions_target_idx" ON "review_actions" USING btree ("target_type","target_id");

--> statement-breakpoint
CREATE TABLE "suppression_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_type" "suppression_rule_type" NOT NULL,
	"pattern" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
-- ============================================================
-- Foreign key constraints
-- Added after every table above exists, so ordering here never matters
-- — grouped by the same sections as above, for readability.
-- ============================================================

--> statement-breakpoint
ALTER TABLE "news_item_sources" ADD CONSTRAINT "news_item_sources_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "news_item_sources" ADD CONSTRAINT "news_item_sources_source_item_id_collected_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "news_item_relations" ADD CONSTRAINT "news_item_relations_news_item_a_id_news_items_id_fk" FOREIGN KEY ("news_item_a_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "news_item_relations" ADD CONSTRAINT "news_item_relations_news_item_b_id_news_items_id_fk" FOREIGN KEY ("news_item_b_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "news_item_politicians" ADD CONSTRAINT "news_item_politicians_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "news_item_politicians" ADD CONSTRAINT "news_item_politicians_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_politician_id_politicians_id_fk" FOREIGN KEY ("claimant_politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_sources" ADD CONSTRAINT "claim_sources_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_sources" ADD CONSTRAINT "claim_sources_source_item_id_collected_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_targets" ADD CONSTRAINT "claim_targets_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_targets" ADD CONSTRAINT "claim_targets_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_responses" ADD CONSTRAINT "claim_responses_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_responses" ADD CONSTRAINT "claim_responses_response_news_item_id_news_items_id_fk" FOREIGN KEY ("response_news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_responses" ADD CONSTRAINT "claim_responses_response_claim_id_claims_id_fk" FOREIGN KEY ("response_claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_relations" ADD CONSTRAINT "claim_relations_claim_a_id_claims_id_fk" FOREIGN KEY ("claim_a_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "claim_relations" ADD CONSTRAINT "claim_relations_claim_b_id_claims_id_fk" FOREIGN KEY ("claim_b_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "politician_priority_issues" ADD CONSTRAINT "politician_priority_issues_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "politician_priority_issues" ADD CONSTRAINT "politician_priority_issues_issue_area_id_issue_areas_id_fk" FOREIGN KEY ("issue_area_id") REFERENCES "public"."issue_areas"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "politician_priority_issues" ADD CONSTRAINT "politician_priority_issues_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promises" ADD CONSTRAINT "promises_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promises" ADD CONSTRAINT "promises_issue_area_id_issue_areas_id_fk" FOREIGN KEY ("issue_area_id") REFERENCES "public"."issue_areas"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_sources" ADD CONSTRAINT "promise_sources_promise_id_promises_id_fk" FOREIGN KEY ("promise_id") REFERENCES "public"."promises"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_sources" ADD CONSTRAINT "promise_sources_source_item_id_collected_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_relations" ADD CONSTRAINT "promise_relations_promise_a_id_promises_id_fk" FOREIGN KEY ("promise_a_id") REFERENCES "public"."promises"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_relations" ADD CONSTRAINT "promise_relations_promise_b_id_promises_id_fk" FOREIGN KEY ("promise_b_id") REFERENCES "public"."promises"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_evidence" ADD CONSTRAINT "promise_evidence_promise_id_promises_id_fk" FOREIGN KEY ("promise_id") REFERENCES "public"."promises"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_evidence" ADD CONSTRAINT "promise_evidence_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_evidence" ADD CONSTRAINT "promise_evidence_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_evidence" ADD CONSTRAINT "promise_evidence_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "promise_evidence" ADD CONSTRAINT "promise_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
