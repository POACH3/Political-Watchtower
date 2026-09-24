# Political Watchtower

A party-agnostic political aggregator that provides citizens with a low-friction way to see who represents them, what those
representatives have actually done (votes, sponsored bills, news
coverage), and how they compare to their peers. Every claim and data-driven view is supported by original-source links, promoting transparency and making independent research easier.

## Goals

- **Primary-source first.** Voting records and bill sponsorships come
  from official government data and publish automatically, with a source
  link on every item.
- **Narrative content is clearly labeled.** Bios, news articles, social media posts, and any
  AI-generated summaries always link back to their original source/author
  and are marked as narrative, not primary-source fact.
- **Promises and actions.** Campaign promises are tracked with sources
  and a fulfillment status, not just whether they were kept or not.
- **Nonpartisan.** This is an accountability tool, not an advocacy
  platform — the same treatment applies regardless of party.
- **Built to be forked.** Codebase is designed so anyone in another state (or country) can point it at their own political body without too much of a hassle.

## Structure

Four main components:  
- **Data collectors:** A collection of modules that can be selected (e.g. a government API, an RSS/news crawler, a manual upload form, etc.).
- **Data aggregator:** A modular interface that aggregates data from multiple sources (APIs, webscraping, upload, etc.). Normalizes whatever the collectors return into one shared schema, regardless of source.
- **Data processors:** A collection of modules that can be selected. Each can take the aggregated data and distill it into useful information: issue tagging, claim extraction, voting alignment, AI summaries.
- **Data presenter:** Modular interface that that render processor output as
  digestible, honest views of the results with links back to primary sources. Includes data visualizers, filters, and text summaries.

The core app is jurisdiction-agnostic — each jurisdiction implements a
common "jurisdiction adapter" (a data collector), so the app never
hardcodes assumptions about any one state's data source. Any collector
type can also run on its own — a fork with no usable government API can
rely on manual upload alone. An admin interface (not yet built — see
"Current status" below) will be where an operator triggers collector
runs, uploads data by hand, and reviews flagged content.

Full architecture decisions and the stage-by-stage build plan live in
[SPEC.md](SPEC.md).

## Current status

Stages 0-2 (repo scaffold, government-records schema, narrative/
oversight schema) are done and verified end-to-end — schema generated,
migrated against real Postgres from a clean volume, and every
constraint that matters tested directly, not just documented as if it
holds: the provenance `NOT NULL`s, the `Term` exclusion constraint,
`PoliticianExternalId`'s uniqueness, `ClaimSource`'s one-primary-per-claim
partial unique index, the deferred triggers guaranteeing every
`Claim`/`Promise` has a primary source and every `NewsItem` at least one
source (including against a source being re-parented, deleted, or
demoted out from under one after the fact), cross-table consistency
(a term's district is in its chamber, a vote's bill is in its session,
...), and `NULL`-safe uniqueness where a column can be absent. Tests run
against their own throwaway `_test` database, recreated and migrated on
every run, never the dev one.

Stage 3 (pilot-state government data ingestion) is next. Two things
worth naming so they aren't assumed to be further along than they are:

- **Issue-area taxonomy unseeded** — the `issue_areas` table exists but
  no fixed list has actually been chosen yet. Needed before Stage 6
  (radar chart) or Stage 9 (ML tagging upgrade) can use it.
- **Service layer is partial** — only `collected_items`,
  `jurisdictions`/`chambers`, and `politicians` have service functions so
  far, enough for Stage 1/2's own tests. Stage 3 needs `bills`/`votes`/
  `terms` functions before it can ingest anything; Stage 8-10 will need
  `news_items`/`claims`/`promises` ones.

Everything past Stage 2 (real pilot-state data, the admin GUI,
presenters, processors) exists only as schema and design in SPEC.md, not
in code yet.

## Data model

Everything ties back to a `Politician` — a person, not just an
officeholder, so a first-time candidate who's never won an election is
represented the same way as an incumbent:

- **Jurisdictions & elections** — `Jurisdiction`, `Chamber`,
  `LegislativeSession`, `District`, `Election`, `Candidacy`. What someone
  ran for and where, independent of whether they won.
- **Committees & meetings** — `Committee`, `CommitteeMembership`,
  `Meeting` — committee assignments and the meeting/floor calendar,
  same primary-source treatment as everything else in this group.
- **People & positions** — `Politician`, `Term`, plus alias/external-ID
  tracking so the same person doesn't fork into duplicate profiles across
  sources or jurisdictions.
- **Legislation** — `Bill`, `Vote`, `VoteRecord`, `IssueArea` (a
  two-level hierarchy, so a handful of broad topics serve as comparison
  axes while finer topics support specific search) — primary-source
  government records, published automatically since the source itself is
  the verification.
- **Promises & priorities** — `Promise` (with fulfillment tracking,
  evidence-framed rather than a bare "kept"/"broken" verdict) and
  self-reported priority issues, kept separate from voting-derived issue
  alignment so stated priorities can be compared against actual votes.
- **News & claims** — `NewsItem`/`SocialPost` for raw content, `Claim` for
  specific attributed statements extracted from it. A claim is never
  asserted as true by the site itself — each one carries its own
  verification status, its sources, and a link back to where it came from.
- **Affiliations** *(designed, not yet built — Stage 10)* — `Affiliation`, a structured record of a relationship
  (board seat, financial interest, employment, family tie) that could
  bias how a politician acts on an issue — same provenance/verification
  treatment as a `Claim`, since it's just as disputable.
- **Provenance & review** — every piece of collected data traces back to
  a `CollectedItem` (what was fetched, from where, when); every processor
  run is itself a recorded, versioned fact (`ProcessorRun`); anything a
  human corrects gets logged (`ReviewAction`) so an automated pipeline run
  can't silently overwrite the correction. (`PipelineEvent`, the broader
  automated-change log, is designed but not yet built — Stage 9/10.)
- **Public accounts & community flags** *(designed, not yet built —
  `User` in Stage 4, `CommunityFlag` in Stage 16)* — logged-in users can flag
  something as wrong (`CommunityFlag`); an admin reviews and either acts
  on it or dismisses it. Kept structurally separate from politicians'
  own public-record data, with a real minimal-PII design.

Anything marked "designed, not yet built" (plus `CollectorJob` and
`ProfileSummary`) exists only in SPEC.md; each is scheduled in a stage's
Build list there. Full field-level schema — every table, relationship, and constraint —
lives in SPEC.md's "Aggregator output schema," "Claim-preserving content
model," and "Provenance chain & processor accountability" sections.

## Tech stack

- **Framework:** Next.js (TypeScript) — one deployable unit, no separate
  frontend/backend repos to keep in sync.
- **Database:** Postgres 15 or newer (the schema uses `NULLS NOT DISTINCT`
  unique constraints) — the comparison/scorecard features need real
  relational queries across politicians × votes × issue areas.
- **Packaging:** Docker / Docker Compose. Deliberately **no IaC**
  (no CDK/Terraform/Serverless) — the whole app is a portable container,
  not tied to any one cloud provider's tooling.
- **Hosting:** self-host with `docker compose`, or deploy the container
  manually to AWS (App Runner, Amplify Hosting, ECS) or any other
  Docker-friendly host (Fly.io, Render, Railway). No vendor lock-in by
  design, since forks should be cheap to run anywhere.

Full rationale for each of these is in SPEC.md's "Cross-cutting
architecture decisions."

## Forking and deployment

**Status:** local dev and the database schema are real and working (see
"Current status" above); deployment and pointing a fork at a real
jurisdiction are not proven yet. This section describes the intended
shape for the parts that aren't built, so forkers know what to expect:

- **Local dev:** `docker compose up` brings up the app and a Postgres
  instance together and applies the migrations — no separate DB install
  needed. Config (DB
  connection, any third-party API keys) is read from a `.env` file, with
  a checked-in `.env.example` documenting what's required.
- **Self-hosting:** the same `docker compose up` flow works on any machine
  with Docker — a VPS, a home server, whatever. No cloud account required.
- **Deploying to AWS:** run the built container manually via App Runner or
  Amplify Hosting — no CDK/CloudFormation stack to stand up first.
- **Deploying elsewhere:** any host that runs a Docker image (Fly.io,
  Render, Railway, etc.) works the same way — point it at the image, set
  the same env vars as local dev.
- **Pointing your fork at your own state:** implement the
  `JurisdictionAdapter` interface (SPEC.md Stage 1) for a jurisdiction
  with a usable government API, or rely on manual upload alone for one
  that doesn't — no core app changes either way. Neither path is proven
  yet; once `JurisdictionAdapter` has been built against two real,
  differently-shaped jurisdictions, this section will cover concrete
  steps instead of just the interface it'll use.

## Repo guardrails

See [CLAUDE.md](CLAUDE.md) for the working rules this repo enforces
(what needs sign-off, what's hard-blocked at the git level, etc).


## Project Info
**Status:** Stage 3. See [SPEC.md](SPEC.md) for the full
build plan.  
**Language:** TypeScript  
**License:** [AGPL-3.0](./LICENSE.txt)  
**Authors:** [POACH3](https://github.com/POACH3)    
**Start Date:** 22-SEP-2026