# Political Watchtower — Project Spec

## Goal

Give voters a fast, low-friction way to see who represents them, what those
representatives have actually done (votes, sponsored bills, news coverage),
and how they compare to peers — so people can vote informed without doing
hours of their own research.

**Pilot jurisdiction:** one US state legislature (both chambers). Kept
generic in this file by design, along with the state-specific facts
referenced in the stages below.
**Planned expansion:** US Congress, then optionally other states.
**Distribution model:** open source (AGPL-3.0, already in `LICENSE.txt`).
The codebase must stay jurisdiction-agnostic enough that someone in another
state or country can point it at their own legislature with minimal changes
— this drives the "jurisdiction adapter" architecture in Stage 1.

**Explicitly not:** a partisan advocacy tool or a monetization strategy. (No data sold, ever)

**Editorial stance:** maximize automation, but automation only applies
*publish-without-review*, not *publish-as-fact*. There are two categories
of content, treated differently:

- **Government records** (votes, bill text, sponsorships) are facts, not
  claims. They publish automatically with a source link — no human gate,
  no verification status needed, because the source *is* the verification.
- **Everything else** (news, social posts, bios beyond basic biographical
  facts, and anything AI-summarized) is treated as a **claim**, never
  asserted as true by the site itself. Every claim carries its own
  `verification_status` (see "Claim-preserving content model" below) —
  that's structured, per-item metadata, not a footer disclaimer doing the
  work. The sitewide disclaimer/methodology page explains things once
  rather than repeating paragraphs everywhere, and sits alongside
  compact per-claim status labels, not instead of them — the
  *explanation* is centralized, the *evidence trail* is not.

*(This split — and everything in "Claim-preserving content model" below —
is a product/engineering response to real defamation exposure in
publishing claims about named public officials, not a substitute for
actual legal counsel. Recommend a real legal review gate (Stage 11)
before Stage 8-10 ship publicly, since those are the stages introducing
third-party claims about real people at any volume. Not blocking Stages
0-7, which are government-records-only.)*

**The two-category split above is the load-bearing summary; here's the
fuller breakdown it collapses, spelled out once so nothing in it gets
conflated in practice:**

- **Raw facts** — votes, bill text, dates, sponsorships, appointments.
  Government records, published as fact, no `verification_status`.
- **Derived facts** — a *computed* statement about raw facts ("voted yes
  on 17 bills tagged Privacy"). Never stored as its own row/fact — always
  recomputed at query time from the raw facts underneath it (see
  "Provenance chain & processor accountability" below). This is what
  keeps a derived number honest: it can't drift from what actually backs
  it, because it isn't cached as an independent assertion.
- **AI-generated summaries** — `Claim.generated_summary` and the Stage 12
  profile-activity summary. Explicitly labeled as generated (the
  disclaimer badge), and grounded in specific rows, never freestanding
  prose.
- **Human/community claims** — `Claim`/`Affiliation`, explicitly
  attributed to whoever said it (`claimant_text`) or submitted it
  (`CommunityFlag.submitted_by`), never to "the site."
- **Editorial classifications** — `IssueArea`/`BillIssueArea` tagging.
  Structured and challengeable (see "Facts vs. interpretations" note in
  "Provenance chain" below), not asserted as objective truth about what
  a bill "is really about."
- **Verification status** — `Claim`/`Affiliation.verification_status`,
  `Promise.fulfillment_status`: unverified/corroborated/disputed/
  verified-shaped, never a bare true/false.

The one discipline this taxonomy exists to enforce: an AI-generated
interpretation (a summary, a classification) must never silently become
a stored raw fact. Concretely, that means a processor never writes
directly to a field with no `verification_status`/`fulfillment_status`/
equivalent alongside it, and derived facts stay computed, never cached
as their own claimable row.

---

## Cross-cutting architecture decisions

These apply to every stage below, so confirming them once now avoids
re-litigating per stage:

1. **No IaC.** The app avoids CDK/Terraform/CloudFormation, staying a
   portable, containerized (Docker) service deployable via
   `docker compose` for self-hosting, or manually to AWS (App Runner,
   Amplify Hosting, or ECS via console) or any other Docker-friendly host
   (Fly.io, Render, Railway) — no vendor lock-in, consistent with "broad
   applicability."
2. **Framework: Next.js (or similar full-stack React framework), Postgres
   database.** [DECISION TO CONFIRM] Recommended over alternatives
   because: (a) it's a single deployable unit — no separate frontend/backend
   repos to keep in sync, which matters for a project other people will
   fork; (b) the comparison/scorecard features (Stage 6) need real
   relational queries across politicians × votes × issue areas, which
   Postgres handles far better than a document store; (c) it has broad
   free-tier hosting options (Vercel free tier, Neon/Supabase free Postgres,
   or self-hosted via Docker) fitting the "free/near-free for now" budget.
   SQLite is the fallback if you'd rather start with zero external
   dependencies for local dev — happy to use it for Stages 0-3 and swap
   later if that's preferred, but Postgres is the better default given the
   comparison-heavy feature set. **Minimum Postgres 15**: the schema uses
   `UNIQUE ... NULLS NOT DISTINCT` (Postgres 15+) and `btree_gist`;
   local dev and CI run 16.
3. **Four-layer modular pipeline** (see [README.md](README.md) "Structure"
   for the canonical description — terminology here matches
   it exactly):
   - **Data collectors** — one module per data source (a jurisdiction's
     government API, an RSS feed, a social platform's oEmbed integration,
     a manually-curated list, ...), each responsible only for fetching its
     own source's raw data. The `JurisdictionAdapter` interface
     (`fetchLegislators`, `fetchVotes`, `fetchBills`, `fetchNews`, ...) is
     the collector contract for government sources specifically; Stage 8's
     RSS/GDELT/oEmbed integrations are collectors of the same kind for
     news and social sources.
   - **Data aggregator** — a modular interface that merges what the
     collectors return into the core data model (`Politician`, `Vote`,
     `Bill`, `NewsItem`/`SocialPost`, `Claim`, ...), regardless of which
     collector or source format it came from.
   - **Data processors** — modules that take aggregated data and distill
     it into derived information: issue-area tagging, the claim
     extraction + `verification_status` pipeline (see "Claim-preserving
     content model" below), voting-alignment calculations, AI
     summarization. Each is a self-contained module, not one monolithic
     transform step.
   - **Data presenter** — modules that render processor output as
     digestible, honest views with links back to primary sources:
     visualizers (radar chart, scorecards, leaderboards), filters, and
     text summaries. This is what Stage 6 builds.

   The core app only knows about these four interfaces, never the
   specifics of any one source/processor/view — that's what makes "point
   it at your own state" and "add/remove a comparison view" both realistic
   for other adopters, per the build-to-be-forked goal.
4. **Every module — presenters, collectors, and processors alike — calls
   shared service functions, never the database directly.** Applies to
   presenters and the worker service alike: Next.js makes it easy to
   query Postgres inline from a Server Component, which quietly turns
   the UI layer into the only place an API contract exists, and two
   separate processes each independently reimplementing "how to safely
   write a `Claim`" (lock checks, suppression rules, the "exactly one
   primary source" invariant) is the same kind of drift risk regardless
   of whether the two implementations are in different languages or just
   different processes. All data access — `getPoliticianProfile(id)`,
   `createClaim(...)`, `setVerificationStatus(...)`, etc. — goes through
   one shared package of named functions, never inline queries anywhere.
   Starting in Stage 5 for presenters (first real pages) and Stage 3 for
   collectors/the worker service, not something to retrofit later. See
   decision #7 for how this same service layer stays reachable if a
   future module isn't TypeScript.
5. **Collectors run in a dedicated worker service, not the web app
   process.** Scheduled API polling and the long-running news/social
   crawler both live in their own Docker Compose service, separate from
   the Next.js app — a crawl hang or scheduling bug shouldn't be able to
   take down the site people are actually visiting, and it keeps
   resource-heavy background work (crawling, and any NLP/ML processors)
   off the request/response path. Details in "Data collector
   architecture" below.
6. **Collector types are independently config-enabled, not fixed by the
   codebase.** Which of the three types (manual upload, API poller,
   crawler) actually run is a per-deployment choice — down to running
   manual upload alone, with every automated collector disabled. See "Data
   collector architecture" below for why this matters beyond flexibility
   for its own sake (jurisdictions without a usable API; operators who
   don't want the crawler's cost/legal surface).
7. **Everything is TypeScript by default; a future non-TypeScript module
   is an option kept open, not something built now.** Considered running
   some processors in Python (its NLP/ML ecosystem is genuinely stronger
   for entity-resolution upgrades, semantic similarity, and sentiment
   analysis specifically) and decided against committing to it — for the
   collectors and processors actually scoped so far, TypeScript is as
   good or better (crawling, LLM-orchestrated claim extraction/
   summarization) or the gap is small enough not to justify a second
   runtime, a second dependency ecosystem, and a fourth Docker Compose
   service. Only issue-area ML tagging, entity resolution, near-duplicate/
   statement-similarity matching, and sentiment analysis are plausible
   future Python candidates — and even those work fine in TypeScript at
   this project's actual scale (one state legislature, modest volume);
   Python would only be worth it if one of them genuinely needs the
   upgrade in practice, judged then, not designed around now. Claim
   extraction and `verification_status`/`SuppressionRule` enforcement
   specifically should stay TypeScript regardless — that's the
   safety-critical core, and splitting it across languages means the same
   rule (e.g. the prompt-injection defense) has to be gotten right twice
   instead of once.

8. **Real accounts with roles, not a single shared admin credential.**
   One `User` table, one `role` column (`'user'` | `'admin'`), ordinary
   session auth — needed because Stage 16's community flagging requires
   login-gated public accounts, and "promote a user to admin" only means
   something if "user" is a real row. Doesn't block Stage 4-15 — a
   single self-registered admin account on day one is operationally
   equivalent to a single shared credential until Stage 16 adds public
   signups.
9. **Abuse resistance is a design property, not a Stage 16 feature.**
    Three distinct threats, already mitigated by decisions made earlier
    for other reasons, called out explicitly here so "resistant to
    abuse" has a real answer instead of being aspirational:
    - **SQL injection** — every query goes through Drizzle's parameterized
      query builder (decision #4's service layer is the only DB access
      path); no raw string-concatenated SQL anywhere in the app.
    - **XSS** — covered under "Validation" below: scraped/submitted text
      and HTML is sanitized on the way in, before storage, not only on
      render.
    - **Prompt injection** — covered under "Validation" below
      ("Defamation-resistant pipeline") for claim extraction specifically;
      the same discipline (collected text passed to an LLM as
      clearly-delimited data, never concatenated as if part of the
      instructions) applies to *every* LLM call this app makes, including
      Stage 12's profile-activity summaries added below — not just claim
      extraction. A prompt-injection payload succeeding against a
      *summary* is just as much a defamation-pipeline failure as one
      succeeding against `verification_status`.

   What decision #4's service layer buys, concretely: because every
   module already goes through shared service functions instead of raw
   queries, staying flexible costs nothing today. A same-runtime
   (TypeScript) module calls those functions directly, in-process — no
   network hop, no availability coupling to another process being up. If
   a non-TypeScript module is ever actually added, it can't import that
   package, so it needs a thin HTTP API wrapping those same functions —
   built only at that point, not speculatively now. That module's only
   path to the data would then be that API, meaning it depends on the
   TypeScript app being up to do anything — an acceptable tradeoff here
   specifically because collector/processor work is async and batched
   (a brief delay during a redeploy costs nothing) and a self-hosted
   `docker compose` deployment typically restarts its whole stack
   together anyway, not piecemeal.

---

## Data collector architecture

Three collector types, each implementing the same `Collector` interface
from the four-layer pipeline above, but with different operational
profiles. **Which ones actually run is a per-deployment config choice, not
a fixed requirement** — the aggregator is source-agnostic (it merges
`CollectedItem`s into the core schema regardless of which collector
produced them), so any combination is valid, including running *only* the
manual upload collector with every automated collector disabled entirely.
That matters for two real reasons, not just flexibility for its own sake:

- **Not every jurisdiction has a usable government API.** Someone forking
  this for a small municipality or a school board may have no structured
  data source at all to poll — manual upload has to be a real substitute
  for primary-source data there, not just a corrections channel, or the
  project doesn't actually work for them.
- **Not every operator wants to run the higher-exposure collectors.** The
  crawler pulls in an LLM budget, entity resolution (Stage 9), and the
  Stage 11 legal review; the API poller alone needs none of that. An
  operator should be
  able to run a minimal, low-risk deployment (manual upload and/or API
  poller only) without being forced into the crawler's cost and legal
  surface just because it exists in the codebase.

1. **Manual upload collector** — a human submits data directly. This
   isn't limited to corrections or promise-tracking (Stage 13's deferred
   "promises vs. actions") — it can supply *any* record type the other
   collectors would otherwise produce (a legislator roster, a vote record,
   a bill), for a jurisdiction or operator that has no automated source at
   all. Lowest volume, but a direct input channel rather than something
   scraped, so it gets the most scrutiny at intake (see Validation below).
2. **API poller** — periodic polling of a structured API. Government
   sources (a legislature's own API, Congress.gov) are the current use
   case, but the interface doesn't assume government-only — any org
   exposing structured data (e.g. a campaign-finance API, should one get
   added later) fits the same contract.
3. **Web/news/social crawler** — long-running, continuous monitoring of
   RSS feeds, GDELT, and (where oEmbed/official APIs don't cover it)
   social platforms.

**Provenance envelope — every collector's output, regardless of type,
carries this before it's eligible for aggregation.** This generalizes what
`Claim`/`NewsItem` already needed in "Claim-preserving content model" to
*all* collected data, including primary-source government records — those
still publish without a review gate, but they still need to be traceable
back to where they came from:

```
CollectedItem
 ├── collector_type      — 'manual_upload' | 'api_poll' | 'crawl'
 ├── collector_id        — which collector instance produced this
 ├── source_url          — link to the origin (required, no exceptions)
 ├── submitted_by        — a person (manual upload) or the collector/job
 │                          itself (automated) — needs a real identity,
 │                          not just "system"
 ├── source_timestamp    — when the source says this was published
 ├── retrieved_timestamp — when we actually fetched/received it
 ├── content_hash        — also doubles as the exact-dedup key (below)
 ├── content_type        — MIME type; how to interpret raw_payload
 │                          (application/json for an API poll,
 │                          text/html for a crawled page, application/pdf
 │                          or image/* for an upload, ...)
 ├── raw_payload          — text, not jsonb; the original fetched
 │                          content verbatim (a raw API response body,
 │                          raw HTML, ...) for small structured content —
 │                          a stored-file reference (path/object key), not
 │                          inline bytes, for binary uploads — same
 │                          "don't mirror everything, keep a pointer"
 │                          instinct as the news provenance decision
 │                          below. Not jsonb: re-serializing a JSON value
 │                          (even via a round-trip through a JS object)
 │                          can reorder/reformat it and stop being
 │                          byte-identical to what was actually fetched,
 │                          which breaks `content_hash` as an integrity
 │                          check over what's actually stored
 ├── intake_status       — pending | passed | flagged | rejected (see
 │                          Validation below — a safety/hygiene judgment,
 │                          distinct from `Claim`'s verification_status,
 │                          which is an editorial one)
 └── intake_locked        — see "Review & audit" (Aggregator output
                             schema, below) — an admin's call on a
                             flagged item survives the next validation
                             pass instead of being silently re-flagged
                             forever                            [admin GUI]
```
`UNIQUE (content_hash, source_url)` — the actual exact-dedup key: a
re-fetch of the same content from the same URL resolves to the existing
row (upsert, not a duplicate insert or an error) rather than accumulating
a fresh row every poll cycle.

This is what every collector **produces**. What follows is the shape the
**aggregator turns it into** — the actual core schema, in Postgres.

**Validation — inspecting for hostile/malicious content, not just
malformed data.** This is the aggregator's gate: nothing gets normalized
into the core schema with `intake_status: passed` until it clears these
checks. (The manual-upload collector also does fast, shallow checks —
file type/size — right at intake, before the file ever reaches the
aggregator, so an obviously bad upload never gets that far.)

- **Sanitization before storage/render.** Scraped/submitted text and HTML
  is untrusted input. An unsanitized `<script>` in a scraped article, or
  in an upload, rendered on a public profile page is a stored-XSS vector
  — and this site profiles real politicians, which invites adversarial
  attention. Sanitize on the way in, not only on render.
- **Upload safety** (manual upload collector specifically) — MIME-type
  verification, size limits, and malware/virus scanning before a file is
  trusted enough to reach the aggregator.
- **Prompt-injection resistance** — specific to this project's design:
  scraped/uploaded raw text eventually gets fed to an LLM (claim
  extraction, summarization — see "Claim-preserving content model"). That
  text is attacker-controlled. Someone could embed instruction-shaped text
  in a post or article specifically trying to manipulate the
  extraction/summarization prompt — e.g. text trying to get itself
  classified as `SUPPORTED_BY_PRIMARY_SOURCE`. Source content must be
  passed to any LLM call as clearly-delimited data, never concatenated in
  a way that lets it read as instructions. This is a hard requirement on
  every processor that calls an LLM, not a nice-to-have — it's exactly the
  kind of gap that would quietly defeat the whole claim-preserving
  architecture from the inside.
- Anything that fails gets `intake_status: rejected` (reason logged) or
  `flagged` for borderline cases — dropped silently only when it's
  unambiguous junk (e.g. a fetch that returned an HTTP error page instead
  of content), never silently accepted.

**API polling — schema-change alerts + respectful scheduling:**
- Every poll response is validated against an expected shape before
  processing continues. A mismatch (missing field, unexpected type, an
  unexpectedly empty result where data was expected) produces an alert,
  not a silent partial-ingest — an API changing its schema out from under
  a collector is exactly the kind of failure that could otherwise corrupt
  data quietly.
- Alerting mechanism: [DECISION TO CONFIRM] given the free/near-free
  budget, recommend a lightweight default — a distinctly-flagged log entry
  plus an optional webhook (Slack/Discord/generic HTTP) configured via an
  env var — rather than requiring a paid monitoring service (Sentry/
  Datadog) by default. Self-hosters who want more can plug one in; nobody
  is forced to pay for one just to run a fork.
- Each collector tracks its own last-successful-poll timestamp and last
  error, so a silently-broken collector is visible (e.g. on an admin/
  status page) even before any alert fires.
- Politeness: respect documented API rate limits, exponential backoff on
  errors/429s, and a polling schedule matched to how often the data
  actually changes — legislative vote data doesn't need per-minute
  polling; don't poll aggressively just because it's technically possible.

**Crawler — long-running, same politeness principles, continuous instead
of scheduled-batch:** respects `robots.txt`, rate-limits per host, and
sends an honest identifying User-Agent (standard etiquette for a
legitimate crawler, and useful if a site operator wants to reach out).

**Where this runs:** collectors' scheduled jobs and the crawler both live
in a dedicated worker service (its own Docker Compose container), not
inside the Next.js app process — see cross-cutting decision #5.
In-process job scheduling (e.g. `node-cron`) inside that worker, not an
external cron daemon or a cloud-specific scheduler (AWS EventBridge,
etc.) — the latter would reintroduce the cloud lock-in the no-IaC
decision was meant to avoid. Settled, not still open: this is a real
three-container footprint (app, Postgres, worker), built starting Stage 3
and reflected in Stage 7's deployment docs, not a one-container app with
this bolted on later.

**Deduplication and entity resolution** — two different problems, handled
at different layers:
- **Exact duplicates** (the same item fetched twice — the same RSS item
  from two feeds, a re-poll before content changed) are cheap and
  structural, checked by the **aggregator** using `content_hash` +
  normalized `source_url` before writing a new row at all.
- **Near-duplicates** (the same story syndicated across outlets with minor
  differences) and **entity resolution** (which `Politician` a mention
  actually refers to — not string-matching a name, which breaks on
  nicknames, shared names, handle variations, misspellings) are harder,
  judgment-laden problems. Both are **processor** jobs, not aggregator
  gates — they produce flags/links on already-aggregated data rather than
  blocking storage. Entity resolution starts from an alias table per
  politician (official name, known nicknames, social handles — seeded
  from Stage 3's primary-source roster), matched via fuzzy string
  matching as the first pass, upgradeable to real entity-linking later —
  the same "start simple, get smarter later" progression already planned
  for issue-area tagging in Stage 1. Ambiguous matches get flagged, not
  guessed, consistent with `Claim`'s `UNKNOWN` status: the system surfaces
  uncertainty instead of silently resolving it in either direction.

---

## Aggregator output schema (core data model)

This replaces the one-line entity list in Stage 1 with actual field-level
shapes. Convention: every entity gets a UUID `id` + `created_at`/
`updated_at`, omitted below for brevity. `updated_at` is kept current by
a `BEFORE UPDATE` Postgres trigger (one hand-written trigger function
shared across every table that has the column), not application code —
a trigger, unlike an ORM's own on-update hook, also covers any raw-SQL
write path, not just ones that go through the app's service layer.
`ReviewAction`/`SuppressionRule` are the exception: append-only audit
tables get `created_at` only, deliberately no `updated_at`/trigger — an
"edited" timestamp on a row that exists specifically to record an
immutable past action would invite the kind of after-the-fact edit an
audit trail exists to rule out.

**Every field below is tagged with which pipeline layer writes it** —
`[aggregator]` fields are set when the row is created/updated from
collected data; `[processor: X]` fields start empty and get filled in by
that processor's own later run. This isn't just documentation — it's the
"Four-layer modular pipeline" boundary made concrete at the schema level,
so it's obvious from the schema itself, not just from prose elsewhere,
that (say) the aggregator has no business writing `mentioned_politicians`.

Not included in this section: `Claim` and its join tables (processor
output — fully specified in "Claim-preserving content model" below, built
in Stage 2), `Affiliation`/`AffiliationSource` (same section; not built
until Stage 10), `ProcessorRun` (built in Stage 2) and `PipelineEvent`
(not built until Stage 9/10) — both in "Provenance chain & processor
accountability" — and `CollectorJob`/`User`/`ProfileSummary`/
`CommunityFlag` (Stage 4/4/12/16 — worker/admin-GUI bookkeeping, auth,
and the public flagging flow, not part of the government-records data
model). Each is scheduled in its own stage's Build list below; none of
them exists as a table yet unless that stage is marked done.

**Two implementation details that apply to every join table below, called
out once here instead of repeated per table:**
- **Uniqueness constraints** should exist wherever a duplicate row would
  be a real bug, not just noise — `PoliticianExternalId` needs `UNIQUE
  (jurisdiction_id, external_id)` (this is what dedup during roster sync
  actually depends on), and `VoteRecord`/`BillSponsor` need `UNIQUE` on
  their politician+parent-row pair (one politician can't have two votes
  on the same roll call, or two sponsor rows on the same bill).
- **Nullable columns inside a `UNIQUE`** need `NULLS NOT DISTINCT` (or
  one partial unique index per arm), because Postgres otherwise treats
  NULLs as distinct and the constraint silently never fires — `Election`
  (nullable chamber/district) and `Meeting` (exactly one of
  committee/chamber is always NULL) use `NULLS NOT DISTINCT`;
  `PromiseEvidence`/`ClaimResponse` (exclusive arcs) use per-arm partial
  indexes.
- **Cross-table consistency is enforced by the database, not by
  convention.** Where a row references two tables that must agree, it's a
  composite FK against a `UNIQUE (id, x)` on the target: a `Term`'s
  district must be in the term's chamber, and its candidacy must be the
  same politician's; an `Election`/`Committee`'s chamber must belong to
  its jurisdiction, and an `Election`'s district to its chamber; a
  `Vote`'s bill must belong to the vote's own session. Composite FKs are
  `MATCH SIMPLE` (skipped when any column is NULL), which is exactly right
  for the nullable arms (procedural votes, statewide races, no tracked
  candidacy); the one hole — a district with no chamber — is closed by a
  `CHECK`. Not enforced: a `Vote`'s chamber against its session's
  jurisdiction (no jurisdiction column to compare, and one adapter serves
  one jurisdiction) — covered by aggregator/service tests instead.
- **Date-range CHECKs:** `LegislativeSession.end_date >= start_date`,
  `District.valid_to >= valid_from`, and `Term.end_date > start_date`
  (strictly — the `Term` exclusion constraint treats a term as the
  half-open range `[start, end)`, and an empty range would never
  conflict with anything).
- **Self-referential relation tables** (`ClaimRelation`, `PromiseRelation`,
  `NewsItemRelation` — `X_a_id`/`X_b_id` pairs) need a canonicalization
  rule (e.g. always store with the lexicographically smaller ID first) so
  a processor re-run doesn't create both `(A, B)` and `(B, A)` as separate
  rows for what's the same relationship.
- **When `jsonb` is appropriate vs. when it isn't**, stated once as a rule
  rather than decided per field: `jsonb` is right for a value whose type
  genuinely varies row-to-row and is never joined or filtered on — see
  `ReviewAction.previous_value`/`new_value` below (`field_changed` varies
  by `target_type`, so the value being corrected is a different type each
  time). It's the wrong choice for anything that needs a real FK, a
  `UNIQUE` constraint, or a "find all X for Y" query — which is exactly
  why `Politician.external_ids` became a real table instead of a jsonb
  map, and why every `[]`-suffixed array field elsewhere in this doc
  became a join table instead. `CollectedItem.raw_payload` looks like a
  `jsonb` candidate by this rule (its shape depends entirely on
  `collector_type`/`content_type`, and it's an archival/re-processing
  artifact, not something joined or filtered on) but is deliberately
  `text`, not `jsonb`: it stores the original fetched content verbatim,
  and re-serializing a JSON value (even via a round-trip through a JS
  object) can reorder/reformat it and stop being byte-identical to what
  was actually fetched — which breaks `content_hash` as an integrity
  check over what's actually stored. Don't reach for `jsonb` as a
  shortcut around designing a join table; do reach for it when the
  alternative is a sparse table of nullable typed columns for a value
  whose type genuinely varies, and not for anything meant to be an exact
  byte-for-byte copy of external input.

### Jurisdictions & elections

`Jurisdiction`/`Chamber` back every other table's jurisdiction/chamber
reference with a real FK rather than a free-form string — without it,
`UNIQUE (jurisdiction_id, external_id)` on `PoliticianExternalId` can't
actually dedup (one collector writes `"CA"`, another writes
`"california"`). `Election`/`Candidacy` also represent a first-time
challenger who's never held office — a bare, contextless `Politician`
row otherwise has nowhere to record "ran for this seat," independent of
whether they won.

```
Jurisdiction
 ├── slug              — stable identifier every FK below actually uses
 │                        (e.g. 'xx-state', 'us-congress') — not a display string
 ├── name
 ├── level              — 'federal' | 'state' | 'local' | 'other'
 └── parent_jurisdiction_id — nullable, FK → Jurisdiction (e.g. a county
                              jurisdiction under its state, if local
                              jurisdictions get added later)
```

```
Chamber
 ├── jurisdiction_id   — FK → Jurisdiction
 ├── slug              — unique within jurisdiction (e.g. 'house', 'senate')
 └── name
```
`UNIQUE (jurisdiction_id, slug)`.

```
LegislativeSession                 — closes the "bill numbers get reused
                                      every session" gap: without this,
                                      polling a second session either
                                      collides HB 123 (2023) with HB 123
                                      (2025) into one row, or creates an
                                      ambiguous pair with no way to tell
                                      them apart
 ├── jurisdiction_id   — FK → Jurisdiction
 ├── external_session_id — the jurisdiction's own label (e.g. "2025
 │                          General Session")
 ├── start_date
 └── end_date           — nullable
```
`UNIQUE (jurisdiction_id, external_session_id)`.

```
District                           — redistricting-aware: a district's
                                      boundaries can change what the same
                                      label refers to, so this is a
                                      dated record, not just a string
 ├── chamber_id         — FK → Chamber (no separate jurisdiction_id — it's
 │                          redundant once chamber_id implies it)
 ├── external_district_id — the jurisdiction's own identifier
 │                          (e.g. "District 12")
 ├── name               — nullable
 ├── valid_from
 └── valid_to           — nullable; null = currently in effect
```
`UNIQUE (chamber_id, external_district_id, valid_from)`.

```
Election
 ├── jurisdiction_id   — FK → Jurisdiction
 ├── chamber_id         — nullable, FK → Chamber (null for a jurisdiction-
 │                          wide race with no chamber, if one ever gets
 │                          added — out of current scope otherwise)
 ├── district_id        — nullable, FK → District (null for an at-large/
 │                          statewide race)
 ├── election_date
 ├── election_type      — 'general' | 'primary' | 'special' | 'runoff' |
 │                          'other'
 └── source_item        — FK → CollectedItem, required
```
`UNIQUE (jurisdiction_id, chamber_id, district_id, election_date,
election_type)`. `jurisdiction_id` stays required here (unlike
`Term`/`District`/`Vote` below) — `chamber_id`/`district_id` are both
nullable on this table, so it isn't always derivable from them the way it
is elsewhere.

```
Candidacy                          — a specific person's run for a
                                      specific seat in a specific
                                      election. This is what lets a
                                      Politician row exist meaningfully
                                      for someone who has never held
                                      office — a challenger gets a
                                      Candidacy the same way an incumbent
                                      gets a Term, and nothing about
                                      Politician, Promise, or
                                      PoliticianPriorityIssue required a
                                      Term to begin with, so this was
                                      mostly a missing-context gap, not a
                                      missing-permission one
 ├── politician_id      — FK → Politician                    [aggregator]
 ├── election_id         — FK → Election                      [aggregator]
 ├── party               — nullable; at the time of this candidacy
 │                          (mirrors Term.party) — same "only provenance +
 │                          the identifying field are required" principle
 │                          as everywhere else: a candidacy is still real
 │                          and worth recording before the party is known,
 │                          or for a nonpartisan race         [aggregator]
 ├── outcome             — 'won' | 'lost' | 'withdrew' | 'pending'
 │                                                              [aggregator]
 └── source_item         — FK → CollectedItem, required         [aggregator]
```
`UNIQUE (politician_id, election_id)`.
A `Candidacy` that resolves to `outcome: 'won'` is what an aggregator sync
uses to create the corresponding `Term` — `Term` gets a nullable
`candidacy_id` FK (below) so a seated legislator's profile can trace back
to the specific race that put them there, without `Candidacy` and `Term`
duplicating the same data.

### Committees & meetings

The pilot state's API exposes committee membership and a meeting/floor
calendar as first-class JSON feeds, the same primary-source-no-review-
gate category as everything else in this section.

```
Committee
 ├── jurisdiction_id     — FK → Jurisdiction                    [aggregator]
 ├── chamber_id          — nullable, FK → Chamber (null for a joint/
 │                          interim committee spanning both chambers)
 │                                                                [aggregator]
 ├── external_committee_id — the jurisdiction's own identifier   [aggregator]
 ├── name                                                        [aggregator]
 └── source_item         — FK → CollectedItem, required          [aggregator]
```
`UNIQUE (jurisdiction_id, external_committee_id)`.

```
CommitteeMembership                — join table; membership has its own
                                      attribute (role), so it's not a bare
                                      many-to-many, same pattern as
                                      BillSponsor
 ├── committee_id        — FK → Committee                        [aggregator]
 ├── politician_id       — FK → Politician                       [aggregator]
 ├── role                — nullable; e.g. 'chair' | 'vice_chair' | 'member'
 │                          (jurisdiction-defined, kept loose rather than a
 │                          fixed enum until a second jurisdiction's data
 │                          shows what's actually portable)     [aggregator]
 └── source_item         — FK → CollectedItem, required          [aggregator]
```
`UNIQUE (committee_id, politician_id)`.

```
Meeting                            — a scheduled committee meeting or
                                      chamber floor time; covers both the
                                      pilot state API's meeting-calendar
                                      and floor-calendar feeds, which
                                      are the same underlying concept
                                      (a scheduled session) with different
                                      filters, not two different entities
 ├── committee_id        — nullable, FK → Committee (null for a chamber
 │                          floor session, which isn't any one committee's)
 │                                                                [aggregator]
 ├── chamber_id          — nullable, FK → Chamber (set when committee_id
 │                          isn't — a floor time belongs to one chamber)
 │                                                                [aggregator]
 ├── external_meeting_id — the jurisdiction's own identifier      [aggregator]
 ├── scheduled_at                                                 [aggregator]
 ├── location            — nullable; text, not a structured address — a
 │                          committee room name isn't geocodable data
 │                          worth a real address model                [aggregator]
 ├── agenda_url           — nullable, link not full-text mirror (same
 │                          copyright-conscious call as bill full text)
 │                                                                [aggregator]
 └── source_item         — FK → CollectedItem, required          [aggregator]
```
`UNIQUE (committee_id, chamber_id, external_meeting_id)` — both FK
columns are part of the key (rather than just `external_meeting_id`)
since the same external ID could otherwise collide across two different
committees' feeds. `CHECK (num_nonnulls(committee_id, chamber_id) = 1)`
— exactly one of the two, mirroring `ClaimResponse`'s exclusive-arc
pattern, since a meeting is either one committee's or one chamber's
floor time, never both and never neither.

### People & positions

```
Politician
 ├── full_name           — required. The one content field that must be
 │                          set beyond provenance — everything else here
 │                          (and everywhere else on this profile: photo,
 │                          bio, votes, promises, news) is optional
 │                                                          [aggregator]
 ├── display_name        — nullable, defaults to full_name [aggregator]
 ├── photo_url           — nullable                        [aggregator]
 ├── bio_text            — nullable                        [aggregator]
 ├── birth_date          — nullable; store birth_date, not a static age
 │                          field — age is computed at read time so it
 │                          never goes stale                [aggregator]
 ├── source_item         — FK → CollectedItem, required (NOT NULL). The
 │                          provenance requirement itself: one source per
 │                          row (matching Term/Bill/Vote/VoteRecord below),
 │                          not per individual field — these are low-stakes
 │                          descriptive facts, not disputable claims, so
 │                          `Claim`'s heavier per-statement provenance
 │                          would be overkill here.          [aggregator]
 └── (external IDs live in `PoliticianExternalId`, below — not a jsonb
      map on this row)
```

```
PoliticianExternalId               — one entry per jurisdiction this
                                      person has held office in — e.g. a
                                      state legislature's member ID now, a
                                      Congress.gov bioguide ID if Stage 15
                                      later elects the same person to
                                      Congress. This is what lets one
                                      Politician row persist across a
                                      jurisdiction change instead of
                                      forking into two people — but that
                                      only works if lookups are reliable,
                                      which a jsonb map doesn't guarantee
                                      the way a real unique constraint
                                      does — a dedicated table, not a
                                      jsonb map on Politician, since the
                                      aggregator depends on "does a
                                      Politician already exist with
                                      external_id X in jurisdiction Y"
                                      being a fast, correct lookup on
                                      every poll, which needs `UNIQUE
                                      (jurisdiction_id, external_id)`,
                                      not a map scan.
 ├── politician_id       — FK → Politician              [aggregator]
 ├── jurisdiction_id     — FK → Jurisdiction              [aggregator]
 └── external_id                                          [aggregator]
```
`UNIQUE (jurisdiction_id, external_id)`.

No `party` field here — party is time-bound (rare but real: politicians
switch parties), so it lives on `Term` below, not on the permanent
identity. "Current party" is derived from the most recent `Term` with a
null `end_date`, not stored redundantly.

Since `full_name` is required, `Term`/`BillSponsor`/`VoteRecord` rows
that reference a `politician_id` the aggregator hasn't synced a name for
yet (out-of-order polling, a partial roster response) need a real answer,
not just "name is required" left unresolved: [DECISION TO CONFIRM]
recommend the aggregator writes a placeholder (`"Unnamed (external_id:
...)"`) rather than blocking ingestion of the Vote/Term/etc. until a name
arrives — blocking risks silently dropping data if the roster sync is
ever delayed or fails outright. The placeholder gets overwritten the
moment a real name syncs in.

```
PoliticianAlias                    — supports entity resolution, see
                                      "Data collector architecture" above
 ├── politician_id       — FK → Politician
 ├── alias_text
 ├── alias_type          — 'legal_name' | 'nickname' | 'social_handle' |
 │                          'former_name' | 'ballot_name' | 'other'
 ├── platform            — nullable, set when alias_type = 'social_handle'
 ├── confidence          — 'confirmed' | 'inferred'
 └── locked              — see "Review & audit" below; stops
                            entity-resolution from overwriting an alias a
                            human already reviewed — `confidence` alone
                            was a proxy for this, not an actual owner
                            distinction                        [admin GUI]
```
`UNIQUE (politician_id, alias_text, alias_type)` — without it, repeated
entity-resolution runs pile up duplicate `inferred` aliases over time,
degrading the fuzzy-match candidate pool it's supposed to improve.
Written by whichever layer established the alias — manual entry (admin
GUI), the aggregator (an official bio listing known handles), or
`[processor: entity-resolution]` (inferred, confidence: 'inferred').

```
Term                                — one row per politician's tenure in
                                       a specific chamber/district; no
                                       separate abstract "seat held
                                       across all time, independent of
                                       who's in it" entity, since nothing
                                       in this schema (including Stage
                                       6's comparison views) needs that
                                       concept on its own
 ├── politician_id       — FK → Politician                [aggregator]
 ├── chamber_id          — FK → Chamber (no separate jurisdiction_id — it's
 │                          redundant once chamber_id implies it)         [aggregator]
 ├── district_id         — FK → District                    [aggregator]
 ├── candidacy_id        — nullable, FK → Candidacy — the race that put
 │                          this person in this seat, if tracked         [aggregator]
 ├── party               — nullable; at the time of this term — see
 │                          Candidacy.party above for why this isn't
 │                          required                          [aggregator]
 ├── start_date                                              [aggregator]
 ├── end_date            — nullable; null = currently serving [aggregator]
 └── source_item         — FK → CollectedItem                [aggregator]
```
No two `Term` rows for the same `politician_id` + `chamber_id` should
have overlapping `[start_date, end_date)` ranges — worth an actual
constraint (Postgres exclusion constraint via `btree_gist`), not just
app-level discipline, since "current party" being derived from "the most
recent `Term` with a null `end_date`" silently breaks the moment two open
terms exist for the same person (a source failing to close out an old
term on a re-election, for instance) — that gives you two "current"
parties/districts with no error raised anywhere. `UNIQUE (politician_id,
chamber_id, start_date)` as a second, ordinary constraint alongside the
exclusion constraint.

### Legislation

```
IssueArea                          — reference data, seeded once, not
                                      itself aggregator output. A
                                      two-level hierarchy, so the radar
                                      chart's ~10-15 broad axes and
                                      finer-grained search both draw on
                                      the same taxonomy at different
                                      depths rather than two separate
                                      systems. Same self-referential FK
                                      pattern as `Jurisdiction.
                                      parent_jurisdiction_id`.
 ├── parent_issue_area_id — nullable, FK → IssueArea (null = top-level;
 │                          e.g. "Privacy" has no parent, "Surveillance"
 │                          has "Privacy" as its parent)
 ├── name
 ├── slug
 └── description
```
Top-level areas (no parent) are the fixed ~10-15-item set the radar
chart's axes use — still deliberately small for a readable chart.
Second-level areas (e.g. Surveillance/Biometrics/Data retention under
Privacy) are what a specific search like "bills involving license-plate
readers" actually matches against, and roll up to their parent for any
view that wants the broad axis instead. `BillIssueArea`/
`PoliticianPriorityIssue` can point at either level — a processor or
admin tags at whatever specificity is actually knowable, and a query
against the parent implicitly includes its children. Legislation and
evidence stay attached to the `Bill`/`Claim` rows regardless of which
level tagged them, so a classification itself stays challengeable — the
underlying bill text doesn't change if the tag turns out to be wrong.

```
Bill                                — all fields below except
                                      external_bill_id/source_item are
                                      nullable, same "only provenance + the
                                      identifying field are required"
                                      principle as Politician — a bill row
                                      is worth creating from a bare roster
                                      poll before its title/status syncs in
 ├── session_id          — FK → LegislativeSession — bill numbers get
 │                          reused every session, so this (not a
 │                          jurisdiction_id) is what makes
 │                          external_bill_id actually unique; no separate
 │                          jurisdiction_id column — session_id implies
 │                          it                                 [aggregator]
 ├── external_bill_id    — the jurisdiction's own identifier
 │                          (e.g. "HB 123")                  [aggregator]
 ├── title               — nullable                           [aggregator]
 ├── summary_text        — official summary, if the source provides one
 │                                                             [aggregator]
 ├── full_text_url       — link, not a full-text mirror (same
 │                          copyright-conscious call as the news
 │                          provenance decision — bill-text copyright
 │                          status isn't safe to assume across every
 │                          jurisdiction this gets forked to) [aggregator]
 ├── introduced_date     — nullable                           [aggregator]
 ├── status              — nullable; normalized enum: introduced /
 │                          in_committee / passed_chamber / passed_both /
 │                          signed / vetoed / failed          [aggregator]
 ├── raw_status          — nullable; the jurisdiction's own status string,
 │                          unnormalized, kept alongside the enum for
 │                          anything jurisdiction-specific the enum can't
 │                          capture                            [aggregator]
 └── source_item                                               [aggregator]
```
`UNIQUE (session_id, external_bill_id)`.

```
BillSponsor                        — join table; sponsorship has its own
                                      attribute (role), so it's not a
                                      bare many-to-many
 ├── bill_id             — FK → Bill                         [aggregator]
 ├── politician_id       — FK → Politician                   [aggregator]
 ├── role                — nullable; 'primary_sponsor' | 'cosponsor' |
 │                          'other'                           [aggregator]
 └── source_item         — FK → CollectedItem, required — sponsorship is
                            a factual assertion about a named person with
                            no review gate, so it needs the same
                            provenance every other government-record
                            table has  [aggregator]
```
`UNIQUE (bill_id, politician_id)`.

```
BillIssueArea                      — entirely processor-owned; the
                                      aggregator never writes this table
 ├── bill_id             — FK → Bill
 ├── issue_area_id       — FK → IssueArea
 └── tagging_method      — 'keyword_mapping' | 'ml_classification'
                            (Stage 1's "start simple, get smarter later")
```
`[processor: issue-area tagging]`

### Promises & priorities

```
PoliticianPriorityIssue            — a politician's self-reported/campaign
                                      priorities, linked to the same
                                      IssueArea taxonomy as bill tagging —
                                      deliberately, so Stage 13 can plot
                                      stated priorities against actual
                                      voting-derived issue alignment on
                                      the same axes, not just list them
 ├── politician_id       — FK → Politician                   [aggregator]
 ├── issue_area_id       — FK → IssueArea                     [aggregator]
 ├── source_item         — FK → CollectedItem, required        [aggregator]
 └── display_order       — nullable, for showing "top 3" style if the
                            source ranks them                  [aggregator]
```

```
Promise                            — structurally similar to Claim (an
                                      attributed statement with required
                                      provenance) but answers a different
                                      question: Claim.verification_status
                                      asks "is this accurately
                                      corroborated," a promise needs "has
                                      this been kept" — a distinct axis,
                                      kept as its own entity rather than
                                      overloading one status field with
                                      two meanings
 ├── politician_id       — FK → Politician (who made the promise)
 │                                                              [aggregator]
 ├── exact_text                                                 [aggregator]
 ├── issue_area_id       — nullable, FK → IssueArea               [aggregator]
 ├── date_made           — nullable; same "only provenance + the
 │                          identifying field are required" principle —
 │                          `exact_text` is what's required here, not the
 │                          date it was made                    [aggregator]
 ├── target_date         — nullable, if the promise itself named a
 │                          deadline (e.g. "by end of my first term")
 │                                                                  [aggregator]
 ├── measurable_criterion — nullable text; what "delivered" would
 │                          concretely look like for this specific
 │                          promise, distinct from `exact_text` (the
 │                          promise as stated) — filled in by whichever
 │                          layer first assesses the promise, not
 │                          required at creation, since a promise is
 │                          worth recording before anyone's worked out
 │                          how to measure it     [processor: promise-tracking]
 ├── fulfillment_status  — 'not_assessed' | 'not_yet_due' |
 │                          'in_progress' | 'stalled' |
 │                          'evidence_of_completion' |
 │                          'evidence_of_partial_completion' |
 │                          'evidence_against_completion' | 'disputed'.
 │                          Deliberately evidence-framed, not verdict-
 │                          framed — "evidence_of_completion," not
 │                          "fulfilled." The site is reporting what the
 │                          evidence shows, not adjudicating whether a
 │                          promise was kept; that distinction is the
 │                          entire point of this field, not a wording
 │                          preference. See `PromiseEvidence` below for
 │                          what a status is actually based on, and
 │                          `assessment_reasoning` for why it was set.
 │                                             [processor: promise-tracking]
 ├── assessment_reasoning — nullable text; why `fulfillment_status` is
 │                          what it is, written by whichever layer set
 │                          it (processor or admin) — makes a status
 │                          change explainable on the page itself, not
 │                          just inferable from the linked
 │                          `PromiseEvidence` rows            [processor: promise-tracking]
 └── fulfillment_locked  — see "Review & audit" below              [admin GUI]
```
[DECISION TO CONFIRM: should `evidence_of_completion`/
`evidence_against_completion` — the two states closest to a real verdict
— require human confirmation (`fulfillment_locked` set by an admin)
before a processor can set them, rather than a processor setting them
freely like every other status? Recommend yes for these two
specifically, given how politically consequential the recommendation
that prompted this section says this feature is; not blocking the
schema design, but worth deciding before Stage 13's promise-tracking
processor actually ships.]

```
PromiseSource
 ├── promise_id      — FK → Promise
 ├── source_item_id  — FK → CollectedItem
 └── relation        — 'primary' | 'supporting'
                        (exactly one 'primary' row per promise, enforced by
                        a partial unique index — mirrors ClaimSource)
```
`UNIQUE (promise_id, source_item_id)`, alongside the partial index above.

```
PromiseRelation                    — same pattern as ClaimRelation: two
                                      promises a processor thinks assert
                                      the same commitment, not merged —
                                      each keeps its own fulfillment_status
                                      since two restatements can diverge
 ├── promise_a_id    — FK → Promise
 ├── promise_b_id    — FK → Promise
 └── relation_type   — 'possible_restatement'
```
`CHECK (promise_a_id < promise_b_id)`, `UNIQUE (promise_a_id, promise_b_id,
relation_type)` — same canonicalization as `ClaimRelation` above.
`[processor: statement-similarity]`

```
PromiseEvidence                    — what fulfillment_status is based on.
                                      Four nullable FKs with a check
                                      constraint requiring exactly one
                                      non-null, rather than a polymorphic
                                      evidence_type/evidence_id pair —
                                      with exactly four known evidence
                                      types and no plan for more, this
                                      gets real referential integrity (no
                                      dangling reference after a Bill is
                                      deleted/merged) at no cost to
                                      flexibility
 ├── promise_id      — FK → Promise
 ├── bill_id         — nullable, FK → Bill
 ├── vote_id         — nullable, FK → Vote
 ├── news_item_id    — nullable, FK → NewsItem/SocialPost
 ├── claim_id        — nullable, FK → Claim
 │                     (exactly one of the four above is non-null)
 └── supports        — 'fulfillment' | 'non_fulfillment' | 'context' —
                        without this, conflicting evidence (a bill showing
                        partial progress vs. a news report calling the
                        promise abandoned) can't be told apart from
                        agreeing evidence
```
One partial unique index per evidence arc — `UNIQUE (promise_id, bill_id)
WHERE bill_id IS NOT NULL`, and likewise for `vote_id`/`news_item_id`/
`claim_id` — not a single `UNIQUE` over all four nullable columns, which
Postgres would never enforce (NULLs compare as distinct, so the combined
key can't collide). `supports` is deliberately not part of any key: one
evidence item has one stance per promise, updated in place, so the same
bill can't be recorded as both `fulfillment` and `non_fulfillment`.
`[processor: promise-tracking]`

### Votes

```
Vote                                — the roll-call event itself, not any
                                       one politician's vote on it
 ├── chamber_id          — FK → Chamber (no separate jurisdiction_id —
 │                          session_id/chamber_id already imply it, same
 │                          redundancy fix as Term/District)       [aggregator]
 ├── session_id          — FK → LegislativeSession               [aggregator]
 ├── external_vote_id    — the jurisdiction's own roll-call identifier.
 │                          Without this, re-polling the same vote has no
 │                          reliable dedup key — matching on
 │                          (bill_id, date, chamber, stage) isn't unique
 │                          when a bill gets two recorded votes at the
 │                          same stage on the same day, which happens —
 │                          and the result is duplicated VoteRecords
 │                          quietly inflating every alignment/attendance
 │                          number in Stage 6                     [aggregator]
 ├── bill_id             — nullable, FK → Bill — nullable because not
 │                          every roll call is on a bill (procedural
 │                          votes, confirmations, resolutions); forcing
 │                          this non-null means the adapter either drops
 │                          those votes (silently wrong attendance-rate
 │                          denominators) or fabricates a Bill row for
 │                          something that isn't one                [aggregator]
 ├── description         — motion/resolution text, for votes with no
 │                          bill, or to distinguish multiple votes on
 │                          the same bill at the same stage           [aggregator]
 ├── vote_date                                                [aggregator]
 ├── vote_stage          — nullable; e.g. 'committee' | 'third_reading' |
 │                          'final_passage' (jurisdiction-defined)
 │                                                              [aggregator]
 ├── result              — 'passed' | 'failed'                [aggregator]
 ├── yea_count / nay_count / other_count — nullable; the 2-value `result`
 │                          enum can't express "tied" / "no quorum" /
 │                          "withdrawn", which real jurisdictions report
 │                                                              [aggregator]
 ├── raw_result          — nullable; the jurisdiction's own outcome
 │                          string, unnormalized — same raw_status/
 │                          raw_value pattern as Bill/VoteRecord, needed
 │                          because `result`'s 2-value enum has the same
 │                          normalization problem those fields solve
 │                          elsewhere                            [aggregator]
 └── source_item                                                [aggregator]
```
`UNIQUE (session_id, external_vote_id)`.

```
VoteRecord                          — one politician's vote on one Vote
 ├── vote_id             — FK → Vote                          [aggregator]
 ├── politician_id       — FK → Politician                    [aggregator]
 ├── value               — normalized enum: 'yea' | 'nay' | 'present' |
 │                          'absent' | 'excused'                [aggregator]
 ├── raw_value           — nullable; the jurisdiction's own value string,
 │                          unnormalized. Kept required-in-spirit (every
 │                          real vote record has one) but not NOT NULL,
 │                          since `value` itself is the field that
 │                          actually has to be known for this row to mean
 │                          anything                              [aggregator]
 └── source_item                                                 [aggregator]
```
`UNIQUE (vote_id, politician_id)` — one politician can't have two votes on
the same roll call.

### News & social

```
NewsItem / SocialPost
 ├── platform            — 'news' | 'x' | 'facebook' | 'instagram' |
 │                          'rss' | 'other'                     [aggregator]
 ├── canonical_url       — the article/post's own URL — distinct from
 │                          whatever CollectedItem.source_url the fetch
 │                          came through (a GDELT-sourced item's fetch URL
 │                          is a GDELT record, not the article itself)
 │                                                                [aggregator]
 ├── published_at        — the item's own publication time (distinct from
 │                          any one CollectedItem's retrieved_timestamp,
 │                          which is when *we* fetched it, not when it
 │                          was published)                        [aggregator]
 ├── content_hash        — for exact-dedup, see below              [aggregator]
 ├── author_name / author_handle                                [aggregator]
 ├── headline_or_text    — the content itself (headline + excerpt for
 │                          news, post text for social)          [aggregator]
 ├── excerpt             — a short quote, not a full-text mirror
 │                          (provenance-storage decision, below)  [aggregator]
 ├── is_suppressed       — see "Retraction & suppression" below   [aggregator/admin]
 ├── suppressed_at        — nullable                               [aggregator/admin]
 └── suppression_reason   — nullable                                [aggregator/admin]
```
`UNIQUE (content_hash, canonical_url)` — the exact-dedup key the
aggregator checks before writing a row; `canonical_url` is normalized
(lowercased scheme/host, no fragment) before it's compared, using the same
helper as `CollectedItem.source_url`.

No `duplicate_of` field — it would be a third, contradictory dedup
mechanism: the aggregator already catches exact duplicates *before*
writing a new row (using this same `content_hash`), so there's no second
row for `duplicate_of` to point at in the normal case, and
`NewsItemRelation` already covers the residual case (two rows that exist
because they looked different enough to both get written, but a
processor later decides they're the same/near-same article). One
mechanism, not two —
`NewsItemRelation.relation_type` gets `'exact_duplicate'` added alongside
`'possible_near_duplicate'` (below) to cover both.

Same pattern as `Claim`/`Promise` — three more array-of-reference fields
here had the identical querying/integrity gap, moved to join tables:

```
NewsItemSource                     — which raw fetch(es) this item came
                                      from; usually one, more than one if
                                      dedup merges multiple fetches of the
                                      same item (e.g. the same article via
                                      two RSS feeds)
 ├── news_item_id    — FK → NewsItem/SocialPost           [aggregator]
 └── source_item_id  — FK → CollectedItem                  [aggregator]
```
`UNIQUE (news_item_id, source_item_id)`. A `DEFERRABLE INITIALLY
DEFERRED` constraint trigger guarantees every `NewsItem` has **at least
one** `NewsItemSource` row at COMMIT (and can't lose its last one while
it still exists) — the same provenance guarantee `Claim`/`Promise` get,
minus "exactly one primary," since this table has no `relation` column.

```
NewsItemRelation                   — same shape as ClaimRelation, for
                                      duplicates/near-duplicates instead
                                      of restatements, including the same
                                      canonical-order CHECK
 ├── news_item_a_id  — FK → NewsItem/SocialPost
 ├── news_item_b_id  — FK → NewsItem/SocialPost
 └── relation_type   — 'exact_duplicate' | 'possible_near_duplicate'
```
`[processor: near-duplicate detection]`. `CHECK (news_item_a_id <
news_item_b_id)`, `UNIQUE (news_item_a_id, news_item_b_id, relation_type)`.

```
NewsItemPolitician                 — replaces mentioned_politicians[];
                                      empty until this processor runs,
                                      claim extraction (Stage 10) depends
                                      on it being populated first
 ├── news_item_id    — FK → NewsItem/SocialPost
 ├── politician_id   — FK → Politician
 ├── confidence      — 'confirmed' | 'inferred' (mirrors PoliticianAlias)
 └── locked          — an admin's correction (confirming or rejecting a
                        mention) survives the next entity-resolution run
```
`[processor: entity-resolution]`. `UNIQUE (news_item_id, politician_id)`.

### Review & audit

The Stage 4 admin review queue, the per-profile "report an error"
channel, and the Stage 11 legal-review gate all assume a human can
correct something — this is what records that a correction happened.
Concretely: an operator manually sets a `Claim` to `DISPUTED_BY_SOURCE`
after reviewing a complaint, and without a lock, the next processor
re-run (or any re-run under a new `ProcessorRun`) silently
recomputes it back. Same problem for a rejected entity-resolution match
or a flagged `CollectedItem` — it just gets re-flagged forever and the
review queue never actually drains.

The fields this needs are already threaded through the entities above
(`Claim.verification_set_by`/`verification_locked`,
`NewsItemPolitician.locked`, and below on `Promise`/`PoliticianAlias`/
`CollectedItem`) rather than centralized, since each is a property of a
specific row's specific status field, not a separate thing. What *is*
centralized is the audit trail itself — "why does your site say this,
and who decided that" needs one place to answer from, not four:

```
ReviewAction                       — one row per human correction, across
                                      every entity that can have one
 ├── target_type      — 'claim' | 'promise' | 'news_item_politician' |
 │                        'politician_alias' | 'collected_item' |
 │                        'affiliation'
 ├── target_id
 ├── field_changed
 ├── previous_value    — jsonb; `field_changed` varies by `target_type`
 │                        (a `verification_status` enum one row, a
 │                        `fulfillment_status` enum another, ...), so the
 │                        value being corrected is a different type each
 │                        time — jsonb captures whatever it actually was
 │                        without a sparse table of nullable typed columns
 ├── new_value         — jsonb, same reasoning
 ├── reason           — nullable
 ├── actor            — the admin identity (Stage 4)
 └── created_at
```
`INDEX (target_type, target_id)` — "show the review history for this
claim" is this table's only real access path. `[admin GUI]` — written whenever
an admin action changes a field that also has a `locked`/
`verification_locked`-style flag; the write and the lock happen together,
not as two separate steps that could drift apart.

**Retraction & suppression.** `Claim`/`NewsItem` above both got
`is_suppressed`/`suppressed_at`/`suppression_reason` fields — soft
suppression, not `DELETE`, specifically so the provenance trail (useful
for a legal defense, not just an offense) survives a takedown. A `CHECK`
keeps the three fields in agreement: a suppressed row always carries when
and (non-blank) why, an unsuppressed one carries neither — so an
un-suppress must clear all three in one `UPDATE` (the history of it lives
in `ReviewAction`, not on the row). `DELETE`
alone has a second problem beyond losing that trail: a syndicated
re-crawl of the same content produces a different `content_hash` and
`source_url`, so exact-dedup doesn't catch it, and a deleted claim just
gets silently re-extracted on the next crawl.

```
SuppressionRule                    — what stops a suppressed claim from
                                      being silently re-created on the
                                      next crawl
 ├── rule_type    — 'url_pattern' | 'content_hash' | 'claim_text_pattern'
 ├── pattern      — the actual match criterion
 ├── reason
 ├── created_by
 └── created_at
```
`[admin GUI]` — checked by the aggregator (for `url_pattern`/
`content_hash`, before writing a `NewsItem`) and the claim-extraction
processor (for `claim_text_pattern`, before writing a `Claim`).

### Public accounts & community flags

`User` is deliberately minimal — see Stage 16 for the public-facing
signup/flagging flow this table supports. The "no PII, bare minimum for
fidelity/security" principle applies to this table specifically (site
accounts), not to politicians' own public-record data elsewhere in this
schema.

```
User
 ├── email               — unique, used for login. Not made optional —
 │                          it's the login mechanism itself, not
 │                          incidental PII collected alongside a
 │                          separate identifier; making it optional would
 │                          need a username-based login as the
 │                          alternative, which isn't in scope here
 ├── password_hash        — hashed, never encrypted — a real distinction,
 │                          not a wording preference: encryption is
 │                          reversible (a key compromise exposes every
 │                          password), a modern password hash
 │                          (bcrypt/argon2/scrypt, not raw SHA-256) isn't
 │                          designed to be. This column never sees
 │                          plaintext, and neither does the app beyond
 │                          the auth layer that computes the hash
 ├── role                 — 'user' | 'admin'
 ├── is_suspended         — nullable-equivalent boolean, default false —
 │                          an abuse-resistance lever independent of
 │                          deleting the account (preserves their
 │                          `CommunityFlag` history for review)
 └── created_at
```
No `name`, no address, no phone — nothing beyond what login and
attribution on a flag submission actually require. `UNIQUE (email)`.
Auth data (this table) stays structurally separate from civic-submission
data (`CommunityFlag`) — the latter references a user by FK, never
duplicates their email/credential inline, so a query or export of flag
data doesn't incidentally carry authentication material with it.

```
CommunityFlag                      — a logged-in user's submission
                                      flagging something as wrong,
                                      distinct from ReviewAction (which
                                      records a correction an admin
                                      already made) — this is the
                                      *request*, ReviewAction is the
                                      *resolution*
 ├── target_type          — same enum as ReviewAction.target_type
 ├── target_id
 ├── submitted_by         — FK → User
 ├── note                 — what the user says is wrong
 ├── counter_evidence_url — nullable; a link to whatever supports the
 │                          flag, so an admin isn't starting from zero
 ├── status               — 'pending' | 'actioned' | 'dismissed'
 ├── resolved_by           — nullable, FK → User (the admin who actioned/
 │                          dismissed it)
 ├── resolved_at           — nullable
 └── created_at
```
`INDEX (target_type, target_id)` — same access pattern, same reasoning,
as `ReviewAction`'s index above. An admin actioning a flag (as opposed to
dismissing it) is expected to also write the corresponding `ReviewAction`
— two rows, not one, since "a user reported this" and "an admin changed
this" are different facts with different actors and shouldn't collapse
into a single row that can't represent "flagged three times, actioned
once."

**Abuse resistance on this specific feature:** login-gated (no anonymous
flags — decision #9's abuse-resistance principle, applied here
specifically), and worth a per-user rate limit on `CommunityFlag`
creation before Stage 16 ships publicly — [DECISION TO CONFIRM: exact
limit, likely something like N per day, revisit once there's real usage
data to tune against rather than guessing a number now].

**Operational privacy principles, beyond what the schema above already
enforces** — infra/ops decisions, not new tables, but stated explicitly
so they're a real commitment rather than assumed:
- Minimal logging — access/request logs kept only as long as actually
  useful for abuse detection and debugging, not indefinitely by default.
- No unnecessary IP address retention — if request logs capture IP at
  all, on a short retention window, not joined into `User`/
  `CommunityFlag` as a permanent column.
- Explicit account/data deletion policy — a `User` can request deletion;
  what actually happens to their `CommunityFlag` history on deletion
  (anonymized vs. retained for audit integrity) needs a real answer
  before Stage 16 ships, not left implicit.
- Encryption at rest and in transit for the database and any backups —
  standard practice, stated here so it's a checked item, not assumed.

---

## Claim-preserving content model (defamation-resistant architecture)

This section governs anything in Stage 8+ (news, social content, AI
summaries) — the parts of the site describing what someone *said* about a
politician, as opposed to Stages 1-7's government records. It exists
because attribution alone ("according to a post...") doesn't automatically
protect a publisher from liability for repeating someone else's
defamatory claim, and while public officials generally have to clear a
high bar (actual malice) to win a defamation suit over official conduct,
that protection isn't something to build the whole system's safety around
— it can vary by jurisdiction, by whether the target counts as a public
figure for the specific statement at issue, and the pilot state's own
courts may apply a different, lower fault standard for private
individuals who might get swept into scraped content. None of this is
legal advice; it's the engineering response to that risk, and a real
legal review (Stage 11) is still the plan before Stage 8-10 ship (see
Editorial stance above).

In pipeline terms (see "Four-layer modular pipeline" above), everything
below is what the **data processor** layer does with claim-bearing
content specifically — collectors and the aggregator just get raw,
attributed content into the database; processors are where verification
status, corroboration, and summarization get computed.

**The core rule: the pipeline extracts and attributes claims, it never
asserts them.**

```
Input → extracted claims → attribution → verification state → summary
```

not:

```
Input → LLM → summary
```

The second shape is what causes an AI summarizer to quietly turn "critics
accuse Smith of corruption" into "Smith is corrupt" — a real risk with a
plain summarization prompt, and the single most important thing to guard
against in Stage 12.

**Data model — `Claim`, a new entity for Stage 2**, layered on top of
`NewsItem`/`SocialPost` (which stays as the raw-content record: the actual
post/article, author, timestamp, URL, platform). A `Claim` is a specific
attributed statement extracted from that raw content:

```
Claim
 ├── news_item_id           — FK → NewsItem/SocialPost, required — lets a
 │                             claim be navigated back to the article/
 │                             post it came from (needed for Stage 5's
 │                             "Claims & allegations" next to "Source
 │                             material" on the same page), and lets
 │                             extraction be re-run scoped to one item
 ├── exact_text              — the original wording, unmodified
 ├── normalized_claim        — a neutral paraphrase for display/search
 ├── claimant_text           — who said it, as written/reported
 ├── claimant_politician_id  — nullable, FK → Politician, when the
 │                             claimant is a politician already tracked —
 │                             lets the site show "this allegation came
 │                             from their opponent," which wasn't
 │                             representable with a bare string
 ├── publication_timestamp
 ├── retrieved_timestamp
 ├── verification_status
 ├── verification_set_by     — 'processor' | 'admin' — see "Review & audit"
 │                             below
 ├── verification_set_at
 ├── verification_locked     — a processor re-run skips a locked row
 │                             instead of silently recomputing over a
 │                             human's override
 ├── is_suppressed           — see "Retraction & suppression" below
 ├── suppressed_at           — nullable
 ├── suppression_reason      — nullable
 ├── processor_run_id        — nullable, FK → ProcessorRun — which
 │                             extraction/summarization pass produced
 │                             this row; processor version, model and
 │                             config are derivable through the join
 └── generated_summary       — the claim-preserving summary, not a bare
                                assertion
```

`ClaimTarget` and `ClaimResponse` (below) replace an inline `target`/
`target_response` on `Claim` itself — a politician reference needs to be
joinable, not a plural field with nothing to join on, and a claim can
have more than one response over time just as one response can address
more than one claim, so neither fits as a single FK on the row:

```
ClaimTarget                        — politician(s) a claim is about
 ├── claim_id         — FK → Claim
 ├── politician_id    — FK → Politician
 └── confidence       — 'confirmed' | 'inferred' (mirrors NewsItemPolitician)
```
`UNIQUE (claim_id, politician_id)`.

```
ClaimResponse                      — replaces target_response; a
                                      politician's statement addressing a
                                      claim, and multi-valued in both
                                      directions
 ├── claim_id                — FK → Claim
 ├── response_news_item_id   — nullable, FK → NewsItem
 ├── response_claim_id       — nullable, FK → Claim (a response is itself
 │                              either a NewsItem/SocialPost or another
 │                              Claim — e.g. a follow-up statement that
 │                              itself gets claim-extracted)
 └── stance                  — 'denies' | 'confirms' | 'clarifies'
```
Exclusive-arc FK, not a `response_type` discriminator + untyped
`response_id`: exactly one of `response_news_item_id`/`response_claim_id`
is set, enforced by a `CHECK (num_nonnulls(...) = 1)` constraint — a real
FK on whichever one applies, not a same-shape-different-meaning ID column
Postgres can't validate. `[processor: claim extraction]` for both.
One partial unique index per arc — `UNIQUE (claim_id,
response_news_item_id) WHERE response_news_item_id IS NOT NULL`, and
likewise for `response_claim_id` — for the same reason as
`PromiseEvidence`: a plain `UNIQUE` over two nullable columns never
fires.

No `source_item`/`supporting_sources[]`/`contradicting_sources[]` here —
sources are joined via `ClaimSource` (below), not array columns, so a
claim can cite as many corroborating or disputing sources as actually
exist, queryably and with a real foreign key on each one. Similarly, when
two independently-sourced statements assert the same underlying thing
(the rally example — two different events, two different quotes, same
commitment) that's a `ClaimRelation`, not a merge: each `Claim` keeps its
own exact wording and its own `verification_status`, since two
restatements can genuinely diverge in what they actually assert.

```
ClaimSource
 ├── claim_id        — FK → Claim
 ├── source_item_id  — FK → CollectedItem
 └── relation        — 'primary' | 'supporting' | 'contradicting'
                        (exactly one 'primary' row per claim, enforced by
                        a partial unique index)
```
`UNIQUE (claim_id, source_item_id)`, alongside the partial index above. A
`DEFERRABLE INITIALLY DEFERRED` constraint trigger on both `claims` and
`claim_sources` additionally enforces "every Claim has exactly one
`primary` ClaimSource row" (not just "has a source of any relation") at
COMMIT — a hand-written trigger, since Postgres has no FK/CHECK that can
express "must have at least one row in another table." It also fires on
DELETE/UPDATE of `claim_sources`, so a primary source can't be
re-parented, deleted, or demoted out from under an existing claim. Same
pattern, same trigger shape, for `Promise`/`PromiseSource` below.

A claim's `news_item_id` (the article it was extracted from) and its
primary `ClaimSource` (the `CollectedItem` the extraction's provenance
traces to) are deliberately **not** constrained to point at the same
underlying fetch: the primary source can be a different, better
`CollectedItem` than any of the news item's own fetches (e.g. a primary
government record backing the claim), and the extraction's provenance
question ("what did this come from") is a separate one from "which
article said it." Only `claims.news_item_id` itself is enforced (real
FK); the relationship between the two is not.

```
ClaimRelation                      — links two Claims a processor thinks
                                      assert the same underlying thing,
                                      without merging them
 ├── claim_a_id      — FK → Claim
 ├── claim_b_id      — FK → Claim
 └── relation_type   — 'possible_restatement'
```
`CHECK (claim_a_id < claim_b_id)` and `UNIQUE (claim_a_id, claim_b_id,
relation_type)` — canonicalization enforced at the DB level, not just app
discipline, so a processor re-run doesn't create both `(A, B)` and `(B,
A)` rows for the same relationship. Same shape as `PromiseRelation`/
`NewsItemRelation` below.
`[processor: statement-similarity]` — same politician + overlapping
issue area + text similarity, flagged for a human/presenter to group,
never auto-merged.

`verification_status` is a **descriptive enum, not a truth score** (a
single AI-generated "94% corrupt" number is its own liability risk — see
below):

- `UNVERIFIED_CLAIM` — default for anything not yet checked against
  another source.
- `SUPPORTED_BY_PRIMARY_SOURCE` — corroborated by Stage 3/15 government
  records (e.g. a campaign-finance claim that matches an actual filing).
- `CORROBORATED` — independently reported by more than one source.
- `CONTRADICTED` — a source disputes or denies it (this is where a
  `ClaimResponse` with `stance: 'denies'` normally lands).
- `DISPUTED_BY_SOURCE` — a named source specifically says it's false
  (parameterized rather than a single `FALSE_ACCORDING_TO_SOURCE_X`
  status, so the disputing source is data, not part of the enum).
- `OPINION` — framed as opinion/commentary, not a factual allegation.
- `SATIRE`
- `UNKNOWN` — extraction succeeded but confidence in classifying it is
  low; surface it as such rather than guessing.

**Provenance storage:** store `source_item`'s metadata plus a content
hash for integrity/audit purposes, not a full-text mirror of the original
article/post — reproducing substantial portions of someone else's
copyrighted article is a separate legal exposure from defamation, and
linking + a short excerpt is much safer than a full copy. [DECISION TO
CONFIRM: hash + short excerpt + link, not full-text snapshot — flag if you
want an archival full-text store for some other reason, e.g. link rot.]

**Sentiment analysis, if it ships as a view (Stage 6/12):** label it as
*"sentiment expressed in this source"*, never *"sentiment toward
[politician]"* — the latter reads as the site asserting something about
the politician rather than describing the text. Keep author sentiment,
commenter sentiment, and model-detected sentiment as distinct, separately
labeled values, and never collapse a sentiment score into a
crime-implying metric like a "corruption score."

**Content organization (Stage 5 profile pages):** organize claim-bearing
content into explicit, separate sections rather than one blended feed —
*Verified facts | Claims & allegations | Responses | Analysis/opinion |
Source material*. This also rules out framing the product itself as an
arbiter of truth: no "The Truth About [Politician]" branding — the
working framing is closer to "what's being said about [politician],
sourced and status-labeled," which is both more defensible and closer to
what the project can actually deliver without silently adjudicating
disputed claims.

**"Disputed" as a first-class, visible state, not just an internal
enum value.** Most of the machinery for this already exists —
`verification_status` already has `CONTRADICTED`/`DISPUTED_BY_SOURCE`
rather than collapsing disagreement into a single "unverified" bucket,
`ClaimSource.relation` already distinguishes `'supporting'` from
`'contradicting'`, and `verification_set_at` already answers "last
reviewed." What's new here is a presentation commitment, not new schema:
a `Claim` with any `'contradicting'` `ClaimSource` rows renders its
supporting and contradicting evidence side by side, not just a status
badge with the dispute implied — matching Stage 8/10's own build items
below once claim extraction actually exists to produce disputed claims.
And restating what "Retraction & suppression" below already establishes,
because it's the same principle applied to a different trigger:
disputed is not the same as wrong, and a claim doesn't get suppressed
just because it's disputed — suppression is for the cases "SuppressionRule"
describes (abuse, confirmed-false content), not for ordinary
disagreement, which is exactly what the `CONTRADICTED` status and the
Responses section already exist to show honestly instead of hiding.

**Section 230 caveat:** Section 230 protects hosting someone else's
speech, but the site's own AI-generated claim extraction, normalization,
and summaries are the site's own output — the more the pipeline
transforms third-party material into new substantive text, the less that
output can be assumed to inherit third-party protection. This is exactly
why the claim-preserving pipeline (attribute, don't assert) matters
operationally, not just as a disclaimer.

### Affiliations (bias/conflict-of-interest relationships)

Distinct from `Claim` — a `Claim` is an attributed
*statement* someone made; an `Affiliation` is a structured, enumerable
*relationship* (board seat, financial interest, employment, family tie,
donor relationship) that could bias how a politician acts on an issue.
Same defamation sensitivity as `Claim`, though: asserting "politician X
sits on the board of company Y" is a factual claim about a relationship,
disputable the same way any other third-party assertion is, so it gets
the same treatment — required primary source, a status field, never
presented as the site's own conclusion about *why* a vote happened.

```
Affiliation
 ├── politician_id      — FK → Politician                        [processor: claim extraction, or admin GUI]
 ├── entity_name         — the company/organization/person the tie is to
 ├── relationship_type   — 'board_member' | 'financial_interest' |
 │                          'employment' | 'family' | 'donor' | 'other'
 ├── description         — nullable; free text for anything the enum
 │                          alone doesn't capture (e.g. dollar amount,
 │                          specific role)
 ├── verification_status — same enum and same meaning as `Claim`'s —
 │                          reusing it rather than a parallel one, since
 │                          "is this sourced/corroborated/disputed" means
 │                          the same thing here as it does for a `Claim`
 ├── source_item         — FK → CollectedItem, required (mirrors
 │                          `Claim`'s "exactly one primary source"
 │                          requirement — same deferred-trigger pattern,
 │                          via a join table, not inlined, for the same
 │                          reason `ClaimSource` isn't inlined: more than
 │                          one source can corroborate the same tie)
 └── is_suppressed       — same soft-suppression pattern as `Claim`/
                            `NewsItem`, for the same retraction reasons
```
`AffiliationSource` — same shape as `ClaimSource` (join table,
`relation: 'primary' | 'supporting' | 'contradicting'`, exactly one
`'primary'` row enforced by a partial unique index, plus the same
deferred-constraint-trigger pattern requiring at least one). Not
respecified field-by-field here since it's a structural copy of
`ClaimSource` with `affiliation_id` in place of `claim_id`.

[DECISION TO CONFIRM: `relationship_type` as a fixed enum vs. free text —
leaning enum for the same "queryable, not just readable" reason
`Claim.verification_status` is an enum; six categories cover what's come
up in review so far, with `'other'` as the release valve, same pattern
as `election_type`/`sponsor_role` elsewhere in this doc.]

**Non-exhaustive list of other legal areas a real lawyer should look at
before Stage 11 clears**, beyond defamation: copyright (how much of an
article gets reproduced vs. linked), platform terms of service for
scraping/embedding, privacy (avoiding data collection on private
individuals who aren't the political figures being profiled), false
light and related state-law claims, election-law exposure if the project
ever becomes affiliated with a campaign/PAC/political ad, and AI-
disclosure/consumer-protection rules depending on how the site markets
itself. The pilot state's specific defamation privilege and
public/private-figure fault-standard split should be part of that same
review.

---

## Provenance chain & processor accountability

Provenance isn't just a supporting mechanism here — it's close to the
actual product: an auditable civic evidence system, not an AI verdict on
politicians. Every fact displayed on the site should be traceable
through an explicit chain, not just "ultimately came from somewhere":

```
source document → source snapshot → extracted observation →
normalized entity → derived analysis → displayed claim
```

Mapped onto entities that already exist, so this is mostly a naming/
completeness exercise, not new architecture:

- **Source document** — the actual page/API response/upload as it
  existed at fetch time; not stored as its own row, but is what
  `CollectedItem.content_hash` is a checksum *of*.
- **Source snapshot** — `CollectedItem` itself: `source_url`,
  `retrieved_timestamp`, `collector_type` (source type/authority),
  `content_hash`, `raw_payload`.
- **Extracted observation** — a `Claim`/`Promise`/`Affiliation` row
  before normalization: `exact_text`, `claimant_text`, tied back to its
  `CollectedItem` via `ClaimSource`/`PromiseSource`/`AffiliationSource`.
- **Normalized entity** — the same row once `verification_status`/
  `fulfillment_status` and FK relationships (`ClaimTarget`, etc.) are
  resolved.
- **Derived analysis** — Stage 6/13's comparison views, computed at
  query time from normalized entities, never stored as a separate fact
  (see "Facts vs. interpretations" below — this is what keeps a derived
  number honest, since it's recomputed from source rows every time, not
  cached as its own assertable fact that could drift from what actually
  backs it).
- **Displayed claim** — what actually renders: `Claim.generated_summary`
  or the raw `exact_text`, each carrying its full chain back through
  every link above — see Stage 17's evidence explorer for making that
  chain actually clickable, not just theoretically traceable.

Two things below make this concrete for every processor and every
field, not just the ones that happened to need them first:
**processing version** (`ProcessorRun`) and **history of corrections**
(`PipelineEvent`).

### `ProcessorRun` — formalizing "processing version" for every processor

Every processor invocation becomes a real row, not just an implicit
fact inferred from a per-row version column existing on some tables and
not others:

```
ProcessorRun
 ├── processor_name       — e.g. 'claim-extraction', 'issue-area-tagging',
 │                           'promise-tracking', 'profile-activity-summary'
 ├── processor_version     — this processor's own code version,
 │                           independent of any model it calls
 ├── model_version         — nullable; the LLM/model identifier+version,
 │                           for processors that use one (issue-area
 │                           keyword-mapping doesn't; claim extraction
 │                           and the Stage 12 summaries do)
 ├── config                — jsonb; the actual prompt template/config
 │                           used for this run, not just "which model" —
 │                           reproducibility needs the exact input, not
 │                           just a version label
 ├── input_ref             — jsonb; what this run actually processed (one
 │                           `CollectedItem` id, a batch, a politician id
 │                           for a profile summary — shape varies by
 │                           processor, same reasoning as
 │                           `ReviewAction.previous_value` being jsonb)
 ├── started_at
 ├── finished_at            — nullable
 ├── status                — 'running' | 'succeeded' | 'failed'
 └── summary               — jsonb (rows written, confidence range,
                              errors) — same "structured stats, not a
                              parsed free-text log" reasoning as
                              `CollectorJob.result_summary`
```
`Claim`/`Promise`/`Affiliation` each carry a nullable `processor_run_id`
FK rather than an inline `model_version` column (`Claim` used to have
one; it was dropped when `ProcessorRun` landed in Stage 2) — the
model/processor version is derivable via the join instead of duplicated
per row.
Mirrors `CollectorJob` (Stage 4) deliberately — collectors and
processors are sibling pipeline layers, and "what ran, when, against
what, with what config" is the same question for both.

### `PipelineEvent` — the event log, broader than `ReviewAction`

`ReviewAction` (already built, "Review & audit" above) stays exactly as
it is — it's specifically "an admin corrected a field that also has a
`locked`-style flag," and that plumbing is already real. `PipelineEvent`
is a separate, broader log covering pipeline-stage events that aren't
admin corrections, so "what did the site know on date X, and why" is
answerable for automated changes too, not just human ones:

```
PipelineEvent
 ├── target_type          — same value set as ReviewAction.target_type
 ├── target_id
 ├── event_type           — 'source_acquired' | 'entity_extracted' |
 │                           'entity_modified' | 'verification_changed' |
 │                           'processor_executed' | 'admin_approved' |
 │                           'admin_reverted'
 ├── processor_run_id     — nullable, FK → ProcessorRun (set for
 │                           processor-caused events)
 ├── actor                — nullable; admin identity, for human-caused
 │                           events (mirrors ReviewAction.actor)
 ├── previous_value        — nullable, jsonb
 ├── new_value             — nullable, jsonb
 └── created_at
```
`INDEX (target_type, target_id)`, same access pattern as `ReviewAction`.

[DECISION TO CONFIRM: write a `PipelineEvent` on *every* field change
everywhere, or scope it to the fields that actually matter for "what did
the site say" — `verification_status`, `fulfillment_status`,
`intake_status`, suppression state? Recommend starting scoped (those
four), since logging every touch to every column is a write-volume cost
without a clear reader for most of it; widen later if "what changed and
when" turns out to matter for a field not on that list.]

**Full entity versioning (an `Entity → v1/v2/v3` snapshot chain, not
just this event log) is explicitly not being built now** — noted instead
under "Open items not yet scheduled" alongside the DB-snapshot idea it's
the same underlying ask as. `PipelineEvent`'s `previous_value`/
`new_value` pair already answers "what changed and when" for the fields
scoped above; a full point-in-time reconstruction of an entire row (or
the whole database) is a larger, separate feature, worth building if
"what did this exact page look like on date X" turns out to be a real
need, not speculatively now.

---

## Validation & acceptance criteria

Each stage below has its own brief "Verification:" line, but those are
spot-checks, not the full bar for "does the code actually meet what this
spec describes." This section is the master list those per-stage checks
should draw from — organized by which specific design decision above
each check is actually holding accountable, not just "does it work."

**Data integrity & idempotency** — protects the session/external-ID/
content-hash work in "Aggregator output schema":
- Re-polling unchanged source data twice produces zero new `Politician`/
  `Term`/`Bill`/`Vote`/`VoteRecord` rows.
- Polling a reused bill number across two different `LegislativeSession`s
  produces two distinct `Bill` rows, not a collision or an ambiguous pair.
- A retried/duplicated fetch of the same roll call never produces two
  `Vote` rows for the same `external_vote_id` — verify the `UNIQUE`
  constraint actually rejects it, not just that this doc says it should.
- An unclosed `end_date` on an old `Term` doesn't silently produce two
  "current" terms for the same politician+chamber.

**Provenance completeness** — protects the "only provenance is required"
principle from "People & positions":
- Every row in every government-record table resolves a non-null
  `source_item` to a real `CollectedItem`.
- Every `Claim`/`Affiliation` has exactly one `ClaimSource`/
  `AffiliationSource` with `relation: 'primary'` — verify the partial
  unique index is real, not aspirational.
- Attempting to insert a `Claim`/`Promise`/`Affiliation` with zero source
  rows fails at the DB layer, not just gets caught later by app logic.

**Defamation-resistant pipeline** — the highest-stakes category; needs an
adversarial regression suite, not spot checks, since this is the single
failure mode "Claim-preserving content model" exists to prevent:
- Feed claim extraction hedge-language input ("critics accuse X...")
  against a small adversarial corpus and confirm the output never
  upgrades to an unqualified assertion.
- Feed it content with an embedded prompt-injection payload and confirm
  `verification_status` isn't influenced by injected instructions.
- Confirm a `verification_locked`/`fulfillment_locked`/`intake_locked`
  row is actually skipped by a subsequent processor run — set a status by
  hand, re-run the processor, verify it holds.
- Confirm a suppressed `Claim`/`NewsItem` never appears in a public
  query, and that a re-crawled syndicated copy (different `content_hash`)
  gets caught by a `SuppressionRule` instead of silently reappearing.

**Fork-ability** — the actual test of "built to be forked," not just a
claim:
- Implement Stage 15's Congress adapter using only the documented
  `Collector` interface, with zero changes to core app code or any other
  adapter — if that's not literally true, the jurisdiction-agnostic claim
  is false.
- A manual-upload-only deployment (every automated collector disabled,
  cross-cutting decision #6) still boots and lets an admin build a
  complete profile by hand — exercise this end to end, since it's
  currently only modeled.
- A Stage 6 comparison view can be added or removed by touching one file
  — proves the presenter layer is actually modular, not just documented
  as such.

**Pipeline-layer boundary enforcement:**
- The `[aggregator]`/`[processor: X]` tagging convention used throughout
  "Aggregator output schema" is currently pure documentation — nothing
  stops an aggregator code path from writing `verification_status`.
  Requires a real decision, not left implicit: either enforce it
  (separate service-layer write functions, or DB-level column grants) or
  explicitly accept it as a code-review convention only.
- Presenter code contains zero direct DB queries (cross-cutting decision
  #4) — checkable with a lint rule banning ORM calls outside the service
  layer.

**Operational / legal:**
- Stage 11's legal sign-off exists as a documented artifact before Stage
  8-10 ship publicly — this is stated as a hard gate multiple times
  above; worth an actual checklist item for it, not just a prose reminder
  that could get skipped in practice.
- Every AI-summarized item's disclaimer badge actually links to the
  methodology page (link-check test).
- A real polling run's request log matches the rate limits the target
  API documents — "the code has a rate limiter" isn't the same claim as
  "it's configured correctly."

---

## Testing strategy

How the checks above actually get run, organized by tooling rather than
by stage since that's what maps to CI. Every category ties back to a
specific line in "Validation & acceptance criteria" above.

**Unit tests** (Vitest, no external dependencies) — pure functions:
`CollectedItem`-to-entity parsers, service functions (decision #4),
enum/status transitions, `raw_status`/`raw_value`-to-normalized-enum
mapping. Fast; every commit.

**Integration tests** (Vitest against a real ephemeral test Postgres —
`testcontainers` or a `docker-compose.test.yml`) — where most of
"Validation & acceptance criteria" is actually exercised:
- *Data integrity & idempotency*: run a collector job twice against
  fixture data, assert zero new rows; a reused bill number across two
  `LegislativeSession`s produces two distinct `Bill` rows.
- *Provenance completeness*: attempt an insert with a null `source_item`
  or zero `ClaimSource` rows, assert the DB rejects it — this suite fails
  loudly if a constraint gets weakened later, not just documents that it
  shouldn't happen.
- *Pipeline-layer boundary*: attempt to write a `[processor: X]`-tagged
  field from aggregator code, assert it's rejected. Only has real teeth
  once "Pipeline-layer boundary enforcement"'s open question above (DB
  grants vs. service-layer-only vs. code-review convention) is actually
  resolved — until then this can only assert the service-layer function
  signatures don't expose the field, which is weaker than a DB-level
  guarantee.

**Adversarial regression suite** (its own runner — versioned fixtures,
possibly real LLM calls, not folded into general unit tests) — the
highest-priority suite given the project's core risk:
- A maintained corpus of hedge-language inputs
  (`tests/adversarial/claim-extraction/*.json`: input text + expected
  non-assertion output pattern) run against claim extraction, checked for
  any upgrade from hedged to bare assertion.
- A corpus of prompt-injection payloads, asserting `verification_status`
  is unaffected by injected instructions.
- Lock-enforcement: set a status by hand, re-run the processor, assert it
  holds.
- Suppression: suppress a claim, feed in a syndicated re-crawl fixture,
  assert `SuppressionRule` catches it before a new `Claim` is written.

This corpus needs a human-reviewed "golden set" — someone has to decide
what correct non-assertive output looks like for each fixture, which
makes this suite partly a content-review artifact, not purely code.

**End-to-end tests** (Playwright, against the full stack — app +
Postgres + worker in Docker Compose): view a profile page, admin logs in
and triggers a `CollectorJob`, submits a manual upload, watches it land
in Postgres via the aggregator. Slower — nightly, or pre-merge only for
stages that touch these flows.

**Fork-ability test fixture:** a minimal *second* `JurisdictionAdapter`
that exists purely as a test fixture — synthetic data, not the real
Stage 15 Congress adapter — used to mechanically prove the interface
doesn't leak assumptions from the pilot state. Run as an integration
test; if it ever needs changes outside its own module, that's an
interface bug caught early rather than discovered during Stage 15 itself.

**Static analysis / lint rules** (ESLint, part of Stage 0's CI):
- Ban raw ORM/query-builder calls outside the service layer (decision
  #4).
- Flag writes to `[processor: X]`-tagged fields from outside that
  processor's module, where feasible as a lint rule rather than a
  runtime check.

**Manual checklists — explicitly not automated**, tracked as a checklist
artifact (PR template or a `CHECKLIST.md`), not CI:
- Stage 11's legal sign-off.
- Spot-checking 10+ AI summaries against source claims before a release.
- Rate-limit compliance — inspecting a real polling run's request log
  against the target API's documented limits, since this needs a live
  run against the real external API, not a mock.

**CI wiring:** unit + integration + lint on every PR; E2E and the
adversarial corpus on every PR touching Stage 8-12 code (nightly
otherwise, to keep PR feedback fast); the fork-ability fixture test joins
the integration suite once Stage 1's interfaces exist.

---

## Staging notes

This plan is deliberately small and numerous rather than a few large
stages, so each stage maps to one thing in "Validation & acceptance
criteria" above that can actually be checked before moving on, and each
stage's migration/PR stays reviewable as a single unit. Because the
schema is provenance-first from Stage 1, new features should be new
stages appended to this list, not migrations of what's already built.

Two structural choices worth calling out rather than leaving implicit:
- **Schema is split into two stages along the same line "Editorial
  stance" already draws** — government records (Stage 1) vs. everything
  claim-bearing (Stage 2) — rather than one giant schema stage, since
  that's the natural seam and keeps each stage's migration reviewable.
- **A real deployment/ship checkpoint (Stage 7) sits in the middle of
  this plan, not just at the end.** Everything through Stage 7 is
  primary-source-only — no LLM, no crawler, no legal exposure — so it's a
  genuinely shippable product on its own per cross-cutting decision #6,
  and shipping it early means Stage 15's fork-ability test (a second
  jurisdiction) can run against a real working app instead of waiting
  until everything else is also done.

---

## Stage 0 — Repo foundations

**Build:**
- Rewrite `CLAUDE.md` to reflect this project (jurisdiction-agnostic,
  no-IaC, automation-first editorial policy, real guardrails like "don't
  commit a profile without sources"). **Done.**
- Scaffold the app (Next.js + TypeScript + Postgres via Docker Compose for
  local dev), basic README explaining the "add your own jurisdiction"
  story for other adopters. README **done**; app scaffold still open.
- CI: lint + typecheck + test on push (GitHub Actions), no deploy step yet.
  Still open.

**Verification:** app boots locally via `docker compose up`, shows a
placeholder homepage, CI passes on an empty test suite. No real data yet.

---

## Stage 1 — Government-records schema + pipeline interfaces

**Build:**
- Jurisdictions & elections: `Jurisdiction`, `Chamber`,
  `LegislativeSession`, `District`, `Election`, `Candidacy` — this is what
  makes a first-time challenger representable and what every other
  entity's jurisdiction/chamber references actually point at, instead of
  free-form strings.
- People & positions: `Politician`, `PoliticianExternalId`,
  `PoliticianAlias` (including its `locked` field — built here since this
  is the stage that creates the table), `Term`.
- Legislation: `IssueArea`, `Bill`, `BillSponsor`, `BillIssueArea`.
- Votes: `Vote`, `VoteRecord`.
- Committees & meetings: `Committee`, `CommitteeMembership`, `Meeting` —
  built with the rest of Stage 1's government-record tables so Stage 3's
  adapter has somewhere to write them.
- `CollectedItem` provenance envelope, including `intake_locked` (same
  reasoning as `PoliticianAlias.locked` — built with the table, not
  retrofitted).
- TypeScript interfaces for all four pipeline layers (`Collector`,
  `Aggregator`, `Processor`, `Presenter` — see "Four-layer modular
  pipeline"), plus a stub/mock `JurisdictionAdapter` with fake data so
  Stage 3+ has something concrete to implement against and Stage 5's UI
  can be built in parallel against mock data. Every `fetchX` returns
  `Collected<T>[]` — records paired with the verbatim response snapshot
  they were parsed from — because every government-record row needs a
  `source_item`, and an adapter that returned only parsed objects could
  never supply one; the adapter never touches the database, the
  aggregator writes one `CollectedItem` per snapshot. `collect()` yields
  every entity kind as tagged records, in foreign-key dependency order.
- The shared service-layer package itself (decision #4) — plain,
  JSON-serializable function signatures, not framework-specific types
  (no Next.js `Request`/React-specific objects in or out). Costs nothing
  now and is what keeps decision #7's option open cheaply: a function
  that already takes/returns plain data is trivial to wrap in an API
  route later if a non-TypeScript module ever needs one; a function
  built around framework internals isn't.

**Key decisions to confirm:**
- Issue-area taxonomy: fixed list (~10-15 areas) vs. free-form tags —
  recommend the fixed list for the radar chart to stay readable, tagged
  via keyword/subject-code mapping initially, ML classification later.

**Verification:** unit tests on the schema + a working mock adapter the
UI can render against; no external calls yet. Confirms the "Provenance
completeness" checks in "Validation & acceptance criteria" at the
constraint level (a `Politician` insert with no `source_item` should
fail, not just be discouraged).

---

## Stage 2 — Narrative & oversight schema

Second schema stage, deliberately separate from Stage 1 — this is the
half of the schema that exists because of third-party content and human
correction, not government records.

**Build:**
- Promises & priorities: `Promise` (incl. `fulfillment_locked`),
  `PromiseSource`, `PromiseRelation`, `PromiseEvidence`,
  `PoliticianPriorityIssue`.
- News & social: `NewsItem`/`SocialPost`, `NewsItemSource`,
  `NewsItemRelation`, `NewsItemPolitician` (incl. its `locked` field).
- Claims (see "Claim-preserving content model"): `Claim` (incl.
  `verification_set_by`/`verification_set_at`/`verification_locked`),
  `ClaimSource`, `ClaimTarget`, `ClaimResponse`, `ClaimRelation`.
- Review & audit: `ReviewAction`, `SuppressionRule`.
- Processor accountability: `ProcessorRun` (see "Provenance chain &
  processor accountability") — built here rather than with the first
  processor because `Claim` and `Promise` carry a nullable
  `processor_run_id` FK to it. `PipelineEvent` (the broader event log)
  has no dependents and an open scope decision, so it waits for Stage
  9/10.

**Verification:** unit tests on the schema, including the constraints
that matter most here specifically — inserting a `Claim` with zero
`ClaimSource` rows fails; exactly one `ClaimSource` per claim can have
`relation: 'primary'`.

---

## Stage 3 — Pilot-state government data ingestion

**Research task — done, findings below (confirmed by direct requests
against the live API, not just its docs page, which turned out to be
sparse on actual response shapes):**
- Legislator roster, bill lists/detail, and committee/meeting-calendar
  data are all real, working JSON feeds, API-key-gated. Bill records
  include a rich status/history trail (a last-action summary, a full
  array of dated status transitions, and a subject/topic list that's a
  strong candidate input for Stage 1's issue-area tagging processor) and
  sponsor IDs, but the status string is
  jurisdiction-raw text ("Governor Signed," not a normalized enum value)
  — confirms the `raw_status`/`status` split already in `Bill` was the
  right call, not just defensive over-design.
- **Gap found, not previously known: no roll-call vote data anywhere in
  this API.** No endpoint returns which legislators voted yea/nay on a
  given bill — confirmed by testing several plausible undocumented paths,
  all 404, and independently by a web search turning up nothing beyond
  third-party aggregators (LegiScan) that apparently source this some
  other way, not from this API. This blocks populating `VoteRecord` (and
  possibly `Vote` itself, depending on whether roll-call metadata like
  yea/nay counts is bundled with vote data or is equally unavailable) from
  the primary adapter as originally scoped. [DECISION TO CONFIRM: how to
  handle this gap — options are (a) ship Stage 3 with `Vote`/`VoteRecord`
  manual-upload-only for the pilot state, accepting that as this
  jurisdiction's real limitation rather than a shortcut; (b) integrate
  LegiScan (or another third party) as a second, vote-specific data
  source, which reopens the "who's the source of truth" question the
  `CollectedItem` provenance model was built to answer cleanly for a
  single source; (c) keep investigating for an undocumented endpoint or
  a non-JSON page that could be scraped instead (crawler collector type,
  not API poller) — recommend (a) to start, since it's honest about what
  this jurisdiction's government actually publishes and doesn't block
  everything else in this stage, with (b)/(c) as later stretch goals.]
- Session and chamber identifiers follow simple, predictable codes (a
  year plus a session-type marker; short chamber codes). Both map cleanly onto `LegislativeSession.external_session_id` and
  `Chamber.slug` as already designed — no schema change needed for these.
- Bill subject/topic lists have no aggregator-owned home in the schema
  (`BillIssueArea` is processor-only). [DECISION TO CONFIRM: the issue-
  area tagging processor re-reads them from the bill's
  `CollectedItem.raw_payload` — recommended, since the payload is kept
  verbatim anyway — vs. adding a `BillSubject` table the aggregator
  writes.]
- The API's committee-membership and meeting-calendar feeds (see
  "Committees & meetings" above) are in scope for Stage 3's real
  adapter, not deferred.

**Build:**
- Real `JurisdictionAdapter` for the pilot state: jurisdiction/chamber/
  session/district seeding, legislator roster, bill list, committee
  roster and meeting calendar, term info — roll-call votes per the
  research finding above, pending the decision on that gap. This is the
  first real API-poller collector, and where the worker service
  (cross-cutting decision #5) and its scheduling/alerting/politeness
  requirements first get built, not retrofitted later. Reference
  implementation, not a hard requirement for every deployment — decision
  #6 still allows manual-upload-only.
- Manual upload collector, built alongside the poller so it's a genuinely
  supported path from the start: any record type above can come from a
  human submission instead of the API, through the same validation gate
  — this is also the fallback path for `Vote`/`VoteRecord` per the gap
  above.
- Scheduled ingestion job (in-process scheduler in the worker service)
  syncing polled data into Postgres via the aggregator.

**Key decisions to confirm:** the roll-call vote data gap above.

**Verification:** directly the "Data integrity & idempotency" checks in
"Validation & acceptance criteria" — re-polling produces zero new
duplicate rows; a reused bill number across two sessions produces two
distinct `Bill` rows; spot-check a handful of records against the
legislature's own website.

---

## Stage 4 — Admin GUI

**Build:**
- Authenticated `/admin` section of the same Next.js app — not a separate
  service (architecture decision #2).
- `User` table (email, password hash, `role`, `is_suspended` — see
  "Public accounts & community flags") — the real auth model from day
  one per decision #8; the first admin account is seeded, no signup flow
  yet.
- `CollectorJob` table unifying scheduled *and* manually-triggered runs
  into one history. Doubles as the collector health tracking from "Data
  collector architecture" — a collector's last-successful-poll status is
  the most recent succeeded `CollectorJob` for it:
  ```
  CollectorJob
   ├── collector_id
   ├── trigger_type     — 'scheduled' | 'manual'
   ├── triggered_by     — admin identity, for manual runs only
   ├── requested_at
   ├── started_at        — nullable
   ├── finished_at        — nullable
   ├── status             — 'pending' | 'running' | 'succeeded' | 'failed'
   └── result_summary     — jsonb (e.g. `{itemsCollected, flagged, errors}`),
                             not a plain string — lets the admin GUI render
                             structured stats instead of parsing free text
  ```
- Worker service's job loop checks this table for pending
  manually-triggered jobs every tick, alongside its own cron schedule —
  the admin GUI's "run now" writes a `pending` row, the worker picks it
  up. Keeps the trigger inside Postgres rather than adding direct HTTP
  calls between the app and worker containers.
- Admin views: collector list (type, enabled/disabled, last run status,
  "run now"); job history/log; manual upload form — the actual
  human-facing interface for the manual upload collector.
- `ReviewAction` write path wired up here even though nothing needs
  correcting yet (no claims exist until Stage 10) — the admin GUI is the
  only thing that ever writes `ReviewAction`, so its plumbing belongs
  with the rest of the admin surface, not bolted on later.

**Key decisions to confirm:**
- Auth: per cross-cutting decision #8, the real `User` table (with
  `role`) from the start, not a single shared credential — a self-service
  signup flow isn't needed until Stage 16, so this stage's own admin
  account can just be seeded directly (a setup script or a one-time env
  var, promoted via the `role` column), but the table/session model is
  the real one from day one rather than something to migrate off later.
- Collector enable/disable (decision #6): [DECISION TO CONFIRM] runtime
  admin toggle (DB-backed) in addition to deploy-time env var, with the
  env var setting the initial state? Leaning yes, flagging since it
  extends decision #6 beyond deploy-time-only.

**Verification:** admin can log in, see the pilot state's collectors
listed, trigger a manual poll run and watch pending → running →
succeeded, and submit a manual upload that reaches Postgres via the same
aggregator path as everything else.

---

## Stage 5 — Politician & jurisdiction profile pages

**Build:**
- Politician profile page: photo, bio, current office/district, voting
  record, sponsored bills — Stage 3 data only, all primary-source, no
  review gate needed. Fetched via service functions
  (`getPoliticianProfile(id)`, etc.), never inline DB queries in the page
  component (decision #4) — this is the stage that habit starts in.
- Page section skeleton now, even though only "Verified facts" has
  content until Stage 10: *Verified facts | Claims & allegations |
  Responses | Analysis/opinion | Source material* (per "Claim-preserving
  content model"). Avoids retrofitting the layout once claims arrive. A
  new sub-section under "Analysis/opinion" for `Affiliation` rows —
  they're claim-shaped (attributed, status-labeled), so they belong in
  the claim-bearing part of the layout, not "Verified facts."
- Jurisdiction profile page — current chamber roster, current election
  candidates (`Candidacy` rows for the active `Election`), past
  officeholders/candidates, recent/current/upcoming bills for the
  jurisdiction's active session, and the `Meeting` calendar. Same
  primary-source-only, no-review-gate treatment as the politician page —
  everything on it is Stage 1/3 government-record data.
- "Quote archive": a `Claim` where `claimant_politician_id` is the
  profiled politician is an *attributed* quote from them (still
  status-labeled like any other claim — attribution isn't verification) —
  the profile page's presenter layer filters to that subset for a
  "quotes" section, needing no separate entity. Doesn't exist until Stage 10
  (claim extraction), same as the rest of "Claims & allegations."
- Lightweight "report an error" link (routes to an issue/email, not a
  moderation queue) — accountability sites get factual pushback and need
  *some* channel for it even under an automation-first policy. Stage 16
  replaces this with the real `CommunityFlag` submission form once
  accounts exist; this stays as the interim channel until then.

**Key decisions to confirm:**
- Bio text source: likely scraped HTML from the legislature's own site,
  not an API — first scraping target under the "hybrid, case by case"
  sourcing decision. Confirm that's acceptable (public official bios on a
  government site, low risk) vs. asking before scraping even this.

**Verification:** every seated legislator in the pilot state has a
working profile page with real name/district/votes; every chamber has a
working jurisdiction page with a correct current roster; spot-check 5-10
against official sources.

---

## Stage 6 — Comparison & visualization modules

**Build:** the data presenter layer's initial modules:
- Radar chart: issue-area stance per politician (vote record ×
  issue-area tagging from Stage 1).
- Voting alignment %: any two politicians, or politician vs. party
  majority. This is the one place party is used as a comparison *axis* —
  distinct from, and not in tension with, the search/filter decision
  below.
- Issue-area scorecard: tabular breakdown by topic.
- Peer leaderboard: bills sponsored, attendance rate, bipartisanship
  score, scoped to one chamber.
- Search/filter for finding politicians by bill, jurisdiction, or issue
  area (e.g. "who's voted on bills touching privacy") — a query surface
  over data that already exists by this stage (`BillSponsor`,
  `BillIssueArea`, `VoteRecord`), not new schema.
  **No party filter, by design** — this site's search/filter surfaces
  are about what a politician has actually done (votes, sponsorships,
  issue areas), not partisan affiliation; the party-comparison *view*
  above is a different feature with a different purpose (an honest
  comparison axis) and isn't affected by this.

**Deferred:** the "stated priorities vs. actual voting record" and
"promises vs. actions" *views* — see Stage 13. The underlying data isn't
actually blocked (an admin can enter `Promise`/`PoliticianPriorityIssue`
rows by hand starting Stage 4), it's specifically the comparison
presenter for that data that waits, so it isn't built against an empty
table.

**Key decisions to confirm:**
- Radar chart axes = the issue-area taxonomy from Stage 1 — needs to be
  settled before this stage starts.

**Not in this stage, flagged for later:**
- Admin control over which of this stage's presenter modules show and in
  what order ("processor presenters" — an admin-configurable dashboard
  rather than a fixed set of views). Genuine future idea, but not worth
  designing against a single hard-coded set of four modules — revisit
  once there are enough presenter modules (post-Stage 13) that "which
  ones, in what order" is a real question rather than a hypothetical
  one.
- Full-text search over `Bill.title`/`summary_text` (and any provisions text the source provides),
  for free-text queries that don't map onto any `IssueArea`.

**Verification:** each view renders correctly against real Stage 3/5
data for at least 3 politicians with meaningfully different voting
patterns.

---

## Stage 7 — Deployment v1 (primary-source-only release)

Everything through Stage 6 is primary-source-only — no LLM, no crawler,
no legal exposure. This stage ships it as a real, working product, not
just a local dev environment — see "Staging notes" above for why this
sits here instead of at the very end.

**Build:**
- `docker-compose.yml` for one-command self-hosting: the Next.js app,
  Postgres, and the worker service.
- Deployment docs for AWS without IaC (App Runner or Amplify Hosting via
  console) and generic Docker deployment docs (Fly.io/Render/Railway).
- Explicit walkthrough of a manual-upload-only deployment (every
  automated collector disabled) as a documented, supported path, not just
  a theoretical one per decision #6.

**Verification:** a clean checkout + `docker compose up` produces a
working site with no manual steps beyond env vars/API keys — and directly
exercises the "Fork-ability" checks in "Validation & acceptance
criteria": the manual-upload-only deployment actually boots and lets an
admin build a complete profile by hand, end to end, not just in theory.

---

## Stage 8 — News & social collectors + aggregator normalization

First stage that touches third-party content, but not yet claims —
collection and normalization only. Per decision #6, none of this runs
unless explicitly enabled; Stage 7's shipped product is unaffected by
whether this stage has landed yet.

**Build:**
- Data collectors — news: RSS from known local outlets for the pilot
  state + GDELT (free, no rate-limit issues) over NewsAPI's free tier
  (non-commercial/delayed-use restrictions, poor fit here). The
  web/news/social crawler type from "Data collector architecture" — same
  respectful-crawling principles (robots.txt, rate limits, honest
  User-Agent) as Stage 3's poller.
- Data collectors — social: official oEmbed (X/Twitter, Facebook,
  Instagram) rather than scraping profiles directly. Manually-curated
  collector as the fallback where no embeddable option exists.
- Data aggregator: normalizes collector output into `NewsItem`/
  `SocialPost` rows (`canonical_url`, `published_at`, `content_hash`,
  excerpt — not a full-text mirror). Enforces the validation gate and
  exact-duplicate check before writing a new row.
- Extend the Stage 4 admin GUI: add these collectors to the list with the
  same `CollectorJob` trigger/status pattern as the poller.

**Key decisions to confirm:**
- Confirm RSS + GDELT over a paid news API given the free-tier budget.
- Which local outlets to pull RSS from — proposed list for your approval
  before wiring them in, since it shapes what coverage looks balanced.
- Confirm hash + excerpt + link over full-text storage.

**Verification:** profile pages (once Stage 10 renders them) will show a
live, < 1 week old feed; for this stage specifically, verify the raw
`NewsItem`/`SocialPost` rows are populating correctly and the
exact-duplicate check actually prevents a re-fetched item from creating a
second row.

---

## Stage 9 — Entity resolution & near-duplicate detection

Runs on Stage 8's output, ahead of claim extraction (Stage 10), which
needs a resolved `ClaimTarget` to work from.

**Build:**
- Entity resolution processor: alias-table + fuzzy-match approach against
  `PoliticianAlias`, writing `NewsItemPolitician` rows with a confidence
  level. Ambiguous matches flagged, never guessed.
- Near-duplicate detection processor: flags likely-syndicated stories via
  `NewsItemRelation` (`relation_type: 'possible_near_duplicate'`).
- `PipelineEvent` (see "Provenance chain & processor accountability"),
  scoped to the four fields that matter for "what did the site say"
  unless that decision is widened — these are the first processors whose
  changes are worth an event log.
- Extend the admin GUI's review queue (Stage 4's `ReviewAction` plumbing)
  to surface both: ambiguous entity matches and flagged near-duplicates,
  for a human to resolve what the pipeline deliberately didn't guess at.

**Verification:** run against a real batch of Stage 8 content; every
mention either resolves with `confidence: 'confirmed'`/`'inferred'` or
lands in the review queue — nothing silently guessed.

---

## Stage 10 — Claim extraction, review & suppression

Ships as one stage deliberately, not split across "build claim extraction"
and "build the ability to correct it" as separate later work — per the
independent schema review, shipping the extraction pipeline without a
working correction/suppression path is the actual gap that made the
defamation-resistant design incomplete in practice.

**Build:**
- Claim extraction processor: parses Stage 9's resolved content into zero
  or more `Claim` rows (`claimant_text`/`claimant_politician_id`,
  `ClaimTarget` row(s), initial `verification_status` — defaults to
  `UNVERIFIED_CLAIM`, or `SUPPORTED_BY_PRIMARY_SOURCE` when directly
  matched against Stage 1 vote/bill records). Source content passed to
  the LLM as clearly-delimited data per the prompt-injection guidance in
  "Data collector architecture" — never concatenated as if part of the
  instructions.
- Best-effort `ClaimResponse` matching: a profiled politician's own
  post/statement addressing a claim gets linked with `stance: 'denies'`
  or `'confirms'`, adjusting `verification_status` accordingly. Heuristic,
  not guaranteed-complete.
- `Affiliation` and `AffiliationSource` tables (see "Affiliations"), with
  the same deferred "exactly one primary source" trigger as
  `Claim`/`Promise`, plus its `processor_run_id` FK.
- `ReviewAction`/lock enforcement made real, not just modeled: an admin
  setting `verification_locked` on a `Claim` must actually cause the next
  processor re-run to skip it.
- `SuppressionRule` enforcement wired into the aggregator (URL/
  content-hash rules, checked before writing a `NewsItem`) and the claim
  extraction processor (text-pattern rules, checked before writing a
  `Claim`).
- Render the "Claims & allegations"/"Responses" sections of Stage 5's
  profile-page skeleton with real data for the first time.

**Verification:** directly the "Defamation-resistant pipeline" checks in
"Validation & acceptance criteria" — the adversarial hedge-language
corpus, the prompt-injection test, the lock-enforcement test (set a
status by hand, re-run the processor, confirm it holds), and the
suppression test (suppress a claim, re-crawl a syndicated copy, confirm
`SuppressionRule` catches it rather than silently re-extracting it). This
stage isn't done until all four pass, not just until claims render.

---

## Stage 11 — Legal review gate

Not build work — a checkpoint. Blocks Stage 8-10's output from being
shown to anyone outside the operator until cleared, per the legal-review
recommendation in "Claim-preserving content model" and the Editorial
stance section above.

**Build:** none. Deliverable is a documented sign-off from actual legal
counsel, covering at minimum: the claim-preserving pipeline's behavior,
the methodology page's wording/placement (Stage 12), the
suppression/retraction process (Stage 10), and the non-defamation areas
already flagged
(copyright, platform ToS, privacy, election law).

**Verification:** the sign-off exists as an artifact (not just "we talked
about it") before Stage 8-10's features are enabled in any
publicly-reachable deployment.

---

## Stage 12 — AI summaries + methodology page

**Build:**
- AI-generated summaries as the last step of the claim-preserving
  pipeline (`Claim.generated_summary`), not a standalone
  LLM-over-raw-text pass — describes the *conversation* around a claim
  (who said what, whether disputed, what corroboration exists), not the
  claim restated as fact.
- A profile-level AI summary, distinct from `Claim.generated_summary`
  above — one paragraph synthesizing a politician's *sourced activity*
  (bills sponsored, notable votes, promises made/kept) into readable
  prose. Summarizes what the record *shows*, not what it *means* — an
  "accomplishments" framing would be the site making a value judgment,
  which the claim-preserving architecture exists to avoid. Same
  prompt-injection discipline as claim extraction (decision #9) applies
  here too, even though the input is the site's own structured data
  rather than scraped text — a bill's `summary_text`
  or provisions/highlights text still originates from a government
  source and gets passed to the LLM as data, not instructions.
  ```
  ProfileSummary
   ├── politician_id
   ├── summary_text        — the rendered prose
   ├── citations           — jsonb array of {sentence_index,
   │                          sources: [{type: 'bill'|'vote'|'promise',
   │                          id}]} — required structured output, not
   │                          retrofitted after generation. See "Grounded
   │                          generation, not post-hoc attribution" below
   │                          for why this has to be part of the same
   │                          generation call.
   ├── processor_run_id    — FK → ProcessorRun
   ├── citation_check_status — 'unchecked' | 'passed' | 'flagged' — see
   │                          below; a summary with 'flagged' status
   │                          doesn't publish until reviewed
   └── created_at / updated_at
  ```
  **Grounded generation, not post-hoc attribution** — the processor's
  prompt requires the model to emit `citations` as part of the same call
  that produces `summary_text`, citing specific `Bill`/`Vote`/`Promise`
  IDs it was given (the candidate set is already known — this processor
  selected those specific rows before the LLM call, so the model is
  citing from a bounded, known set, not recalling from nowhere).
  Deliberately not doing this as a second LLM pass that reads the
  finished summary and guesses which source backs which sentence
  after the fact: a wrong-but-confidently-attached citation is a worse
  failure than no citation, since it makes an inaccurate sentence look
  more verified than it is — exactly the outcome the claim-preserving
  architecture exists to prevent. A second pass *is* still worth having,
  but as a verifier, not a generator: after generation, a cheap
  check (a second LLM call or entailment scoring) confirms each cited
  source actually supports its sentence; a mismatch sets
  `citation_check_status: 'flagged'` and routes to the same admin-review
  path as everything else with a `locked`-style gate, rather than
  auto-publishing an uncertain citation.
- Sitewide methodology page (persistent footer link + dedicated
  `/about/methodology` page), explained once rather than repeated per
  page. Each AI-summarized block gets a badge linking to it — the page
  explains the system, it doesn't substitute for the claim-preserving
  pipeline being careful, which is what's actually doing the
  defamation-risk mitigation. Covers both `Claim.generated_summary` and
  the profile-level summary above. As inspectable as the politicians'
  records this site publishes, not an afterthought page — publishes:
  - **Data sources** — which government API(s), which news/social
    feeds, per jurisdiction.
  - **Collection frequency** — the actual polling/crawl cadence, not
    just "regularly."
  - **Classification methodology** — how issue-area tagging works
    (`tagging_method`: keyword-mapping vs. ML), stated plainly.
  - **Topic taxonomy** — the `IssueArea` hierarchy itself, browsable, not
    just referenced.
  - **AI models/processors in use** — which processors call an LLM,
    which model(s), sourced from `ProcessorRun.processor_name`/
    `model_version` rather than hand-maintained prose that can drift
    from what's actually running.
  - **Verification methodology** — what each `verification_status`/
    `fulfillment_status` value actually means (the enum definitions
    already written out in "Claim-preserving content model" and the
    `Promise` section above, republished here for a public audience).
  - **Correction policy** — how `CommunityFlag`/`ReviewAction` work, from
    a user's perspective: how to flag something, what happens next.
  - **Conflict-of-interest policy** — how `Affiliation` rows get sourced
    and reviewed, and the site's own (lack of) funding/advertising
    relationships that could bias it.
  - **Moderation policy** — suppression criteria (`SuppressionRule`),
    stated in plain terms, not just the schema.
  - **Known limitations** — the roll-call vote data gap from Stage 3 is
    the concrete example on hand right now; whatever else is true at
    ship time belongs here too, kept current rather than written once
    and left stale.
  - **Database schema/API documentation** — a link to this spec (or a
    generated subset of it), for anyone who wants to verify a claim
    about the system's own behavior instead of taking the methodology
    page's word for it.

**Key decisions to confirm:** which LLM/summarization approach fits
"free/near-free" — likely a cheap small model or a strict
summarization budget/cache rather than summarizing on every page load.

**Verification:** manual review of 10+ AI summaries against their source
claims, confirming none upgrade a hedged/attributed claim into a bare
assertion; same review for 10+ profile-level summaries, confirming every
`citations` entry actually corresponds to a real row and every sentence
traces back to a real `Bill`/`Vote`/`Promise` row with none containing a
value judgment the underlying data doesn't directly support; the
citation-check pass actually flags a deliberately-introduced bad citation
in a test case, confirming it isn't a no-op; disclaimer badge present on
every AI-summarized item, both kinds; methodology page covers every item
in the list above, not just some of them — a checklist pass against that
list, not just "the page exists."

---

## Stage 13 — Promise & priority comparison views

Deferred from Stage 6, now unblocked — `Promise`/`PoliticianPriorityIssue`
data has been enterable by hand since Stage 4, so this stage is the
presenter work, not new data plumbing.

**Build:**
- "Stated priorities vs. actual voting record" view, plotting
  `PoliticianPriorityIssue` against the same issue-area axes as Stage 6's
  radar chart.
- Promise tracker view: each `Promise` with its `fulfillment_status` and
  linked `PromiseEvidence`.

**Key decisions to confirm:** whether a dedicated automated collector for
campaign-statement content (platforms, debate quotes) is worth building
now or stays manual-upload-only indefinitely — still the "distinct, more
subjective sourcing problem" flagged back in the original design; not
blocking this stage either way.

**Verification:** both views render correctly against whatever
`Promise`/`PoliticianPriorityIssue` data has been manually entered by
this point — doesn't require a large dataset, just a correct one.

---

## Stage 14 — Deployment v2 (full feature set)

**Build:** update Stage 7's deployment docs and `docker-compose.yml` for
what's landed since — LLM API key configuration, `SuppressionRule`
setup/seeding, and any operational notes from running Stage 8-13 in
practice.

**Verification:** a clean checkout + `docker compose up`, with all
optional collectors enabled, produces a fully-featured working site with
no manual steps beyond env vars/API keys.

---

## Stage 15 — US Congress expansion

The fork-ability acceptance test, not just a scope expansion — see the
"Fork-ability" checks in "Validation & acceptance criteria": this is
where "jurisdiction-agnostic" either turns out to be true or isn't.

**Build:** a second `JurisdictionAdapter` (`CongressJurisdictionAdapter`)
using Congress.gov's official API, implemented using only the documented
`Collector` interface — zero changes to core app code, core schema, or
the pilot state's adapter.

**Key decisions to confirm:** Congress.gov API over ProPublica's —
ProPublica's has had availability issues; Congress.gov is the official,
currently maintained source.

**Verification:** same bar as Stage 3, applied to a sample of the 535
members of Congress — and if implementing this required touching
anything outside `CongressJurisdictionAdapter`'s own module, that's a
finding about Stage 1's interface design, not just a Stage 15 bug.

---

## Stage 16 — Public accounts & community flagging

Appended rather than inserted earlier in the numbering, per "Staging
notes"' rule that new features are new stages appended to the list —
even though this could reasonably run any time after Stage 5 exists
(there's something to flag) and Stage 4's `User`/`role` model exists
(there's something to log into). Note the scope split from Stage 4:
Stage 4 already builds the real `User` table and role column for a
single seeded admin account; this stage is what turns that into a
public-facing feature — self-service signup, the flagging UI, and the
admin-side review queue for flags.

**Build:**
- Public signup/login using the `User` table from Stage 4 — no new
  schema for this part, just the public-facing auth flow (Stage 4 only
  needed a seeded account, not a signup form).
- `CommunityFlag` table and submission form, replacing Stage 5's interim "report an
  error" link — login required (decision #9's abuse-resistance
  principle), captures the item being flagged, a note, and an optional
  counter-evidence link.
- Admin review queue for pending `CommunityFlag` rows, alongside the
  existing `ReviewAction`-writing admin surface from Stage 4/10 — action
  a flag (writes the corresponding `ReviewAction`, same as any other
  admin correction) or dismiss it, either way setting `status`/
  `resolved_by`/`resolved_at`.
- "Promote to admin" admin action, setting another `User`'s `role` —
  the actual capability the multi-admin model (decision #8) exists for.
- Per-user rate limiting on `CommunityFlag` submission — see the
  [DECISION TO CONFIRM] under "Public accounts & community flags" above.

**Key decisions to confirm:**
- Whether this needs its own pass through Stage 11's legal review gate —
  user-generated content (the flag's `note`/`counter_evidence_url`) is a
  new kind of third-party input this app stores and an admin acts on,
  distinct from what Stage 11's original sign-off covered (the
  claim-extraction/AI-summary pipeline). Recommend treating it as
  in-scope for a legal check before this stage ships publicly, not
  assuming Stage 11's original sign-off already covers it.
- Rate-limit specifics (see above) — needs real usage data to tune, not
  a number guessed in advance.

**Verification:** a logged-in test user can submit a flag on a live
`Claim`; it appears in the admin queue; actioning it writes a real
`ReviewAction` and updates the flag's status; a second admin account
promoted via the new action can log in and do the same, proving `role`
is actually enforced and not just a column that exists.

---

## Stage 17 — Evidence explorer

Last stage on the list deliberately — "click any sentence, see exactly
what backs it" is real, committed scope, not an open idea, but it's
sequenced last on purpose: it's a presenter-layer feature built almost
entirely from data every earlier stage already produces as a side effect
of the provenance-first design, not something that needed architecting
in from the beginning. The one piece that genuinely needed a decision
made *before* this stage — grounded citation generation for the
profile-level summary — is Stage 12's `ProfileSummary.citations`, built
back when the summary itself was built, specifically so this stage
wouldn't need to retrofit attribution onto already-published prose.

**What needs zero new schema, because it already exists:**
- `Claim`/`Promise`/`Affiliation` — `ClaimSource`/`PromiseSource`/
  `AffiliationSource` already link every one to its exact source(s);
  `exact_text` is already the "raw data" excerpt, no need to reach into
  `CollectedItem.raw_payload` at display time.
- Government records (`Bill`, `Vote`, `Politician`, ...) — `source_item`
  is already required NOT NULL; the normalized row's own fields already
  are the "raw data" (no excerpt-extraction problem here at all, since
  the fact *is* the row, not a quote pulled from a larger document).
- `Claim.generated_summary`/`Promise` equivalents — inherit their parent
  row's existing sources; no per-sentence attribution problem since the
  summary is about one row.
- Every case above also has `ProcessorRun`/`verification_set_at` (or
  `retrieved_timestamp` for records with no verification step) already
  available for the PROCESSING/LAST VERIFIED parts of the evidence
  panel.

**What this stage actually builds:**
- The evidence panel/modal UI itself: CLAIM (the sentence/fact as
  displayed) → EVIDENCE (the specific row(s)) → SOURCE
  (`CollectedItem`'s `source_url`/`collector_type`) → RAW DATA
  (`exact_text` or the normalized row's own fields, per the case above)
  → PROCESSING (`ProcessorRun.processor_name`/`processor_version`/
  `model_version`, where one exists) → LAST VERIFIED
  (`verification_set_at`/`retrieved_timestamp`).
- Multiple sources displayed as a list when more than one exists
  (primary + supporting + contradicting) — not collapsed to one, per
  `ClaimSource`'s existing `relation` field.
- For `ProfileSummary` specifically: resolves each sentence's
  `citations` entry to its `Bill`/`Vote`/`Promise` row(s) — the one
  place this stage actually depends on an earlier stage (Stage 12)
  having stored the right thing, rather than everything being derivable
  from data that already existed regardless.
- Frontend plumbing to carry span-to-source metadata through to the
  client wherever claim-bearing or profile-summary text renders, plus a
  lightweight lookup so clicking doesn't cost a full page load.

**Key decisions to confirm:** none beyond what's already settled in
Stage 12 — this stage is presentation work against an already-designed
data shape, not new architecture.

**Verification:** on a live profile page, clicking any claim-bearing
sentence or profile-summary sentence opens a panel with a working
CLAIM/EVIDENCE/SOURCE/RAW DATA/PROCESSING/LAST VERIFIED breakdown;
a sentence backed by multiple sources shows all of them, correctly
labeled by `relation`; a `ProfileSummary` with a `'flagged'`
`citation_check_status` never renders its evidence panel as if the
citation were confirmed.

---

## Stage 18 — Community processors

Also last-things-done, deliberately, same reasoning as Stage 17: this is
real, committed scope, not an open idea — but "let external contributors
write `Processor` modules" is high-risk enough (running code this
project didn't write) that it earns its own late stage rather than
being folded into Stage 9/10's own processor work.

**The load-bearing decision this whole stage rests on:** untrusted code
never runs against production, full stop. Submissions go through GitHub
(reusing its existing review/diff/CI/identity tooling instead of
building a bespoke submission portal), pass an automated scan +
one controlled, monitored, throwaway execution against fixture data
(never real data, never real credentials), and only *after* a human
admin has read the code and the scan report does an approved version
ever touch anything real — at which point it's not "sandboxed
third-party code" anymore, it's an ordinary first-party processor, held
to the same standard as anything else in the codebase. This is why no
persistent sandbox infrastructure needs building: the dangerous step
(running unreviewed code against real data) is designed out of the
pipeline entirely, not mitigated after the fact.

**Build:**
- `community-processors/` — a separate directory (not mixed into the
  core `Processor` set), so core maintainers reviewing a submission and
  each deployment's own admin choosing whether to *run* it stay two
  distinct decisions (see `CommunityProcessor.is_active_core` below vs.
  a per-deployment enable toggle, mirroring collectors' own
  enable/disable pattern from decision #6) — approving a processor for
  the core distribution shouldn't force every self-hoster to run it.
- Documentation covering three things, published alongside the
  methodology page (Stage 12): the `Processor` interface itself (input/
  output schema, exactly which service-layer functions a processor may
  call — this is the actual "API" being published; there is no live,
  publicly-callable endpoint, only a documented contract to write code
  against), the submission process (open a PR against
  `community-processors/`), and what review/testing a submission will
  go through before anything is merged — stated plainly so a submitter
  knows "passed CI" doesn't mean "approved," a human review does.
- A GitHub Actions workflow that runs on every PR (and every update to
  an already-submitted processor — full pipeline reruns each time, no
  fast path for a previously-approved author) and produces one
  structured scan report, covering:
  - **Static analysis** (no execution): banned/dangerous APIs
    (`eval`/`Function`/`child_process`/dynamic `require`/direct `fs`
    outside a scratch dir/direct `process.env` access), obfuscated or
    pre-minified source (hard reject — submitted code has to be the
    actual reviewable source), hardcoded secrets, and a dependency
    manifest check (exact-pinned versions, every import backed by a
    declared dependency).
  - **Dependency/supply-chain scan:** known-vulnerability scan across
    the full tree, install/postinstall script detection on any direct
    or transitive dependency (the most common real-world supply-chain
    attack vector — installed with `--ignore-scripts` for the scan
    regardless), typosquat/low-reputation package flags.
  - **One monitored execution** against fixture data, network- and
    filesystem-instrumented: every outbound connection attempt (host,
    port, protocol) logged and diffed against a declared allowlist the
    submission states upfront, with raw-IP/non-standard-port/private-IP
    connections (especially cloud metadata endpoints) flagged
    specifically; any attempt to open a listening socket flagged as a
    backdoor pattern; any filesystem access outside the module's own
    directory/scratch space flagged; CPU/wall-clock/memory usage
    measured against a budget; external API call rate and (if
    applicable) LLM token cost measured against a cap.
  - **Correctness/output validation**, from that same monitored run:
    output matches the declared schema, the same input produces the
    same output on a repeat run (reproducibility — feeds `ProcessorRun`
    the same way any other processor's run does), output contains no
    injectable content (same concern as sanitizing collected input, now
    applied to processor *output*), and output only touches the
    fields/tables its declared processor type is allowed to write (the
    `[aggregator]`/`[processor: X]` boundary already named in
    "Validation & acceptance criteria," now checked against a processor
    whose author isn't a core maintainer).
  ```
  CommunityProcessor
   ├── name
   ├── repo_url / pr_reference
   ├── submitted_by        — GitHub identity, not this app's own User
   │                          table — no reason to require a site
   │                          account just to open a PR
   ├── version              — the approved commit hash
   ├── scan_report          — jsonb; the full static+dynamic findings
   │                          above, kept as the actual record an admin
   │                          reviewed, not just a pass/fail flag
   ├── approved_by          — FK → User (admin) — the accountability
   │                          record: whoever approved a version is the
   │                          responsible party for its effects, same
   │                          principle as ReviewAction.actor
   ├── approved_at
   └── is_active_core       — whether the core distribution ships this
                              version at all; a deployment's own
                              per-processor enable toggle is a separate,
                              later decision each operator makes for
                              themselves
  ```

**Key decisions to confirm:** none beyond what's already settled above —
this stage is a pipeline and a review discipline, not new open design
questions.

**Verification:** a deliberately-planted-bad test submission (a
postinstall script, a call to an undeclared host, output that writes
outside its declared scope) actually gets caught by the scan and never
reaches merge — a dry run of the pipeline against known-bad input, not
just confirming it works against known-good input; a legitimately clean
submission passes the scan, gets reviewed, merged, and runs correctly
once an admin flips it active; `approved_by` correctly records who
approved it.

---

## Open items not yet scheduled

- Additional state adapters beyond the pilot state (explicitly optional
  per your answer — "may expand... but may not").
- Contributor docs for someone else standing up their own jurisdiction
  adapter (natural follow-up once 2 adapters exist and the interface has
  proven itself against real, different data shapes).
- **DB snapshots for archival/diffing** — periodic full-database
  snapshots so "what did this politician's profile say six months ago"
  is answerable, beyond what `created_at`/`updated_at` and
  `ReviewAction`'s per-field audit trail already give row-by-row. Real
  idea, not scoped to a stage — revisit once there's enough live data for
  "diff over time" to be something people actually want, not just
  theoretically nice.
- Two things worth noting explicitly so they don't get reintroduced as
  "gaps" later, since both are already fully handled by existing design:
  **exact-duplicate collected data** is already prevented, not just
  marked, by `collected_items`'s
  `UNIQUE (content_hash, source_url)` plus `createCollectedItem`'s
  upsert-and-return-existing-id behavior — a re-poll of unchanged content
  never reaches a processor a second time. **A modular/pluggable
  interface for different government APIs** is already what
  `JurisdictionAdapter` (decision #3) is — Stage 15's Congress adapter is
  the proof of that, not a second mechanism.
