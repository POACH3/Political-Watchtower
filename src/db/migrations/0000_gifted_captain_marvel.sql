CREATE TYPE "public"."collector_type" AS ENUM('manual_upload', 'api_poll', 'crawl');--> statement-breakpoint
CREATE TYPE "public"."intake_status" AS ENUM('pending', 'passed', 'flagged', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."candidacy_outcome" AS ENUM('won', 'lost', 'withdrew', 'pending');--> statement-breakpoint
CREATE TYPE "public"."election_type" AS ENUM('general', 'primary', 'special', 'runoff');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_level" AS ENUM('federal', 'state', 'local');--> statement-breakpoint
CREATE TYPE "public"."alias_confidence" AS ENUM('confirmed', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."alias_type" AS ENUM('legal_name', 'nickname', 'social_handle', 'former_name', 'ballot_name', 'other');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('introduced', 'in_committee', 'passed_chamber', 'passed_both', 'signed', 'vetoed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sponsor_role" AS ENUM('primary_sponsor', 'cosponsor');--> statement-breakpoint
CREATE TYPE "public"."tagging_method" AS ENUM('keyword_mapping', 'ml_classification');--> statement-breakpoint
CREATE TYPE "public"."vote_result" AS ENUM('passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."vote_value" AS ENUM('yea', 'nay', 'present', 'absent', 'excused');--> statement-breakpoint
CREATE TABLE "collected_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_type" "collector_type" NOT NULL,
	"collector_id" text NOT NULL,
	"source_url" text NOT NULL,
	"submitted_by" text NOT NULL,
	"source_timestamp" timestamp with time zone,
	"retrieved_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"content_type" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"intake_status" "intake_status" DEFAULT 'pending' NOT NULL,
	"intake_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidacies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"politician_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"party" text NOT NULL,
	"outcome" "candidacy_outcome" DEFAULT 'pending' NOT NULL,
	"source_item" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chambers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"chamber_id" uuid NOT NULL,
	"external_district_id" text NOT NULL,
	"name" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"chamber_id" uuid,
	"district_id" uuid,
	"election_date" date NOT NULL,
	"election_type" "election_type" NOT NULL,
	"source_item" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"level" "jurisdiction_level" NOT NULL,
	"parent_jurisdiction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jurisdictions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "legislative_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"external_session_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "politician_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"politician_id" uuid NOT NULL,
	"alias_text" text NOT NULL,
	"alias_type" "alias_type" NOT NULL,
	"platform" text,
	"confidence" "alias_confidence" NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politician_aliases_politician_id_alias_text_alias_type_unique" UNIQUE("politician_id","alias_text","alias_type")
);
--> statement-breakpoint
CREATE TABLE "politician_external_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"politician_id" uuid NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politician_external_ids_jurisdiction_id_external_id_unique" UNIQUE("jurisdiction_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "politicians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"display_name" text,
	"photo_url" text,
	"bio_text" text,
	"birth_date" date,
	"source_item" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"politician_id" uuid NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"chamber_id" uuid NOT NULL,
	"district_id" uuid NOT NULL,
	"candidacy_id" uuid,
	"party" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"source_item" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_issue_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"issue_area_id" uuid NOT NULL,
	"tagging_method" "tagging_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_issue_areas_bill_id_issue_area_id_unique" UNIQUE("bill_id","issue_area_id")
);
--> statement-breakpoint
CREATE TABLE "bill_sponsors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"politician_id" uuid NOT NULL,
	"role" "sponsor_role" NOT NULL,
	"source_item" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_sponsors_bill_id_politician_id_unique" UNIQUE("bill_id","politician_id")
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"external_bill_id" text NOT NULL,
	"title" text NOT NULL,
	"summary_text" text,
	"full_text_url" text,
	"introduced_date" date NOT NULL,
	"status" "bill_status" NOT NULL,
	"raw_status" text NOT NULL,
	"source_item" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_session_id_external_bill_id_unique" UNIQUE("session_id","external_bill_id")
);
--> statement-breakpoint
CREATE TABLE "issue_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_areas_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "vote_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid NOT NULL,
	"politician_id" uuid NOT NULL,
	"value" "vote_value" NOT NULL,
	"raw_value" text NOT NULL,
	"source_item" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_records_vote_id_politician_id_unique" UNIQUE("vote_id","politician_id")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"chamber_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"external_vote_id" text NOT NULL,
	"bill_id" uuid,
	"description" text,
	"vote_date" date NOT NULL,
	"vote_stage" text NOT NULL,
	"result" "vote_result" NOT NULL,
	"yea_count" integer NOT NULL,
	"nay_count" integer NOT NULL,
	"other_count" integer NOT NULL,
	"source_item" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_jurisdiction_id_external_vote_id_unique" UNIQUE("jurisdiction_id","external_vote_id")
);
--> statement-breakpoint
ALTER TABLE "candidacies" ADD CONSTRAINT "candidacies_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidacies" ADD CONSTRAINT "candidacies_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidacies" ADD CONSTRAINT "candidacies_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chambers" ADD CONSTRAINT "chambers_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_parent_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("parent_jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legislative_sessions" ADD CONSTRAINT "legislative_sessions_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politician_aliases" ADD CONSTRAINT "politician_aliases_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politician_external_ids" ADD CONSTRAINT "politician_external_ids_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politician_external_ids" ADD CONSTRAINT "politician_external_ids_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politicians" ADD CONSTRAINT "politicians_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_issue_areas" ADD CONSTRAINT "bill_issue_areas_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_issue_areas" ADD CONSTRAINT "bill_issue_areas_issue_area_id_issue_areas_id_fk" FOREIGN KEY ("issue_area_id") REFERENCES "public"."issue_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsors" ADD CONSTRAINT "bill_sponsors_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsors" ADD CONSTRAINT "bill_sponsors_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsors" ADD CONSTRAINT "bill_sponsors_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_session_id_legislative_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."legislative_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_records" ADD CONSTRAINT "vote_records_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_records" ADD CONSTRAINT "vote_records_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_records" ADD CONSTRAINT "vote_records_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_session_id_legislative_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."legislative_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_source_item_collected_items_id_fk" FOREIGN KEY ("source_item") REFERENCES "public"."collected_items"("id") ON DELETE no action ON UPDATE no action;