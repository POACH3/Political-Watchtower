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

**Explicitly not:** a partisan advocacy tool.

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
  work. The one sitewide disclaimer/methodology page you asked for still
  exists, and still explains things once rather than repeating paragraphs
  everywhere — but it now sits alongside compact per-claim status labels,
  not instead of them. That reconciles with your original "disclaimer
  once, prominently" call: the *explanation* is centralized, the
  *evidence trail* is not.

*(This split — and everything in "Claim-preserving content model" below —
is a product/engineering response to real defamation exposure in
publishing claims about named public officials, not a substitute for
actual legal counsel. Recommend a real legal review gate (Stage 11)
before Stage 8-10 ship publicly, since those are the stages introducing
third-party claims about real people at any volume. Not blocking Stages
0-7, which are government-records-only.)*

---

## Cross-cutting architecture decisions

These apply to every stage below, so confirming them once now avoids
re-litigating per stage:

1. **No IaC.** Per your steer, we avoid CDK/Terraform/CloudFormation. The
   app is a portable, containerized (Docker) service deployable via
   `docker compose` for self-hosting, or manually to AWS (App Runner,
   Amplify Hosting, or ECS via console) or any other Docker-friendly host
   (Fly.io, Render, Railway) — no vendor lock-in, consistent with "broad
   applicability."
2. **Framework: Next.js (or similar full-stack React framework), Postgres
   database.** [DECISION TO CONFIRM] I'm recommending this over alternatives
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
   comparison-heavy feature set.
3. **Four-layer modular pipeline** (see [README.md](README.md) "How it's
   structured" for the canonical description — terminology here matches
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
   for other adopters, per your build-to-be-forked goal.
5. **Presenters call service functions, never the database directly.**
   Next.js makes it easy for page/component code to query Postgres inline
   (e.g. straight from a Server Component) — convenient short-term, but it
   quietly turns the UI layer into the only place an API contract would
   exist, which makes extracting a separate backend later an exercise in
   reverse-engineering one rather than just moving files. Costs nothing to
   avoid now: all data access from presenter code goes through named
   service functions (e.g. `getPoliticianProfile(id)`,
   `getVotingAlignment(a, b)`) defined alongside the processor/aggregator
   layer, not inline queries in page/component code. Starting in Stage 5
   (first real pages), not something to retrofit later.
6. **Collectors run in a dedicated worker service, not the web app
   process.** Scheduled API polling and the long-running news/social
   crawler both live in their own Docker Compose service, separate from
   the Next.js app — a crawl hang or scheduling bug shouldn't be able to
   take down the site people are actually visiting, and it keeps
   resource-heavy background work (crawling, and any NLP/ML processors)
   off the request/response path. Details in "Data collector
   architecture" below.
7. **Collector types are independently config-enabled, not fixed by the
   codebase.** Which of the three types (manual upload, API poller,
   crawler) actually run is a per-deployment choice — down to running
   manual upload alone, with every automated collector disabled. See "Data
   collector architecture" below for why this matters beyond flexibility
   for its own sake (jurisdictions without a usable API; operators who
   don't want the crawler's cost/legal surface).

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
 ├── raw_payload          — inline (jsonb/text) for small structured
 │                          content (API responses, article text); a
 │                          stored-file reference (path/object key), not
 │                          inline bytes, for binary uploads — same
 │                          "don't mirror everything, keep a pointer"
 │                          instinct as the news provenance decision below
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
inside the Next.js app process — see cross-cutting decision #6.
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
`updated_at`, omitted below for brevity.

**Every field below is tagged with which pipeline layer writes it** —
`[aggregator]` fields are set when the row is created/updated from
collected data; `[processor: X]` fields start empty and get filled in by
that processor's own later run. This isn't just documentation — it's the
"Four-layer modular pipeline" boundary made concrete at the schema level,
so it's obvious from the schema itself, not just from prose elsewhere,
that (say) the aggregator has no business writing `mentioned_politicians`.

Not included here: `Claim` (processor output — already fully specified in
"Claim-preserving content model" below) and `CollectorJob` (Stage 4's
worker/admin-GUI bookkeeping, not part of the public data model).

**Two implementation details that apply to every join table below, called
out once here instead of repeated per table:**
- **Uniqueness constraints** should exist wherever a duplicate row would
  be a real bug, not just noise — `PoliticianExternalId` needs `UNIQUE
  (jurisdiction_id, external_id)` (this is what dedup during roster sync
  actually depends on), and `VoteRecord`/`BillSponsor` need `UNIQUE` on
  their politician+parent-row pair (one politician can't have two votes
  on the same roll call, or two sponsor rows on the same bill).
- **Self-referential relation tables** (`ClaimRelation`, `PromiseRelation`,
  `NewsItemRelation` — `X_a_id`/`X_b_id` pairs) need a canonicalization
  rule (e.g. always store with the lexicographically smaller ID first) so
  a processor re-run doesn't create both `(A, B)` and `(B, A)` as separate
  rows for what's the same relationship.

### Jurisdictions & elections

Added after an independent review surfaced that `jurisdiction_id` and
`chamber` were free-form strings on five different tables with no backing
table — which makes the `UNIQUE (jurisdiction_id, external_id)` constraint
on `PoliticianExternalId` meaningless in practice (one collector writes
`"CA"`, another writes `"california"`, and dedup silently fails). Also closes a
real scope gap: a first-time challenger who's never held office had
nowhere to exist in the schema except as a bare, contextless `Politician`
row — `Election`/`Candidacy` below is what actually represents "ran for
this seat," independent of whether they won.

```
Jurisdiction
 ├── slug              — stable identifier every FK below actually uses
 │                        (e.g. 'ut', 'us-congress') — not a display string
 ├── name
 ├── level              — 'federal' | 'state' | 'local'
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

```
District                           — redistricting-aware: a district's
                                      boundaries can change what the same
                                      label refers to, so this is a
                                      dated record, not just a string
 ├── jurisdiction_id   — FK → Jurisdiction
 ├── chamber_id         — FK → Chamber
 ├── external_district_id — the jurisdiction's own identifier
 │                          (e.g. "District 12")
 ├── name               — nullable
 ├── valid_from
 └── valid_to           — nullable; null = currently in effect
```

```
Election
 ├── jurisdiction_id   — FK → Jurisdiction
 ├── chamber_id         — nullable, FK → Chamber (null for a jurisdiction-
 │                          wide race with no chamber, if one ever gets
 │                          added — out of current scope otherwise)
 ├── district_id        — nullable, FK → District (null for an at-large/
 │                          statewide race)
 ├── election_date
 ├── election_type      — 'general' | 'primary' | 'special' | 'runoff'
 └── source_item        — FK → CollectedItem, required
```

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
 ├── party               — at the time of this candidacy (mirrors
 │                          Term.party)                        [aggregator]
 ├── outcome             — 'won' | 'lost' | 'withdrew' | 'pending'
 │                                                              [aggregator]
 └── source_item         — FK → CollectedItem, required         [aggregator]
```
A `Candidacy` that resolves to `outcome: 'won'` is what an aggregator sync
uses to create the corresponding `Term` — `Term` gets a nullable
`candidacy_id` FK (below) so a seated legislator's profile can trace back
to the specific race that put them there, without `Candidacy` and `Term`
duplicating the same data.

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
                                      does. A jsonb map was the original
                                      design here; moved to its own table
                                      specifically because the aggregator
                                      depends on "does a Politician
                                      already exist with external_id X in
                                      jurisdiction Y" being a fast, correct
                                      lookup on every poll — that's a job
                                      for `UNIQUE (jurisdiction_id,
                                      external_id)`, not a map scan.
 ├── politician_id       — FK → Politician              [aggregator]
 ├── jurisdiction_id     — FK → Jurisdiction              [aggregator]
 └── external_id                                          [aggregator]
```
`UNIQUE (jurisdiction_id, external_id)`.

No `party` field here — party is time-bound (rare but real: politicians
switch parties), so it lives on `Term` below, not on the permanent
identity. "Current party" is derived from the most recent `Term` with a
null `end_date`, not stored redundantly. Confirmed: party is single-valued
per term (not a set) — the plural in "party(ies)" was about change over
time across different terms, already handled by having multiple `Term`
rows.

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
Term                                — collapses Stage 1's "Office/Term"
                                       into one entity; flagging as a
                                       simplification, not silent scope
                                       change — an abstract "seat held
                                       across all time, independent of
                                       who's in it" concept didn't seem to
                                       earn its keep against anything in
                                       Stage 6's comparison views
 ├── politician_id       — FK → Politician                [aggregator]
 ├── jurisdiction_id     — FK → Jurisdiction               [aggregator]
 ├── chamber_id          — FK → Chamber                     [aggregator]
 ├── district_id         — FK → District                    [aggregator]
 ├── candidacy_id        — nullable, FK → Candidacy — the race that put
 │                          this person in this seat, if tracked         [aggregator]
 ├── party               — at the time of this term         [aggregator]
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
parties/districts with no error raised anywhere.

### Legislation

```
IssueArea                          — reference data, seeded once from the
                                      fixed ~10-15 taxonomy (Stage 1), not
                                      itself aggregator output
 ├── name
 ├── slug
 └── description
```

```
Bill
 ├── jurisdiction_id     — FK → Jurisdiction                [aggregator]
 ├── session_id          — FK → LegislativeSession — bill numbers get
 │                          reused every session, so this (not
 │                          jurisdiction_id alone) is what makes
 │                          external_bill_id actually unique              [aggregator]
 ├── external_bill_id    — the jurisdiction's own identifier
 │                          (e.g. "HB 123")                  [aggregator]
 ├── title                                                    [aggregator]
 ├── summary_text        — official summary, if the source provides one
 │                                                             [aggregator]
 ├── full_text_url       — link, not a full-text mirror (same
 │                          copyright-conscious call as the news
 │                          provenance decision — bill-text copyright
 │                          status isn't safe to assume across every
 │                          jurisdiction this gets forked to) [aggregator]
 ├── introduced_date                                          [aggregator]
 ├── status              — normalized enum: introduced /
 │                          in_committee / passed_chamber / passed_both /
 │                          signed / vetoed / failed          [aggregator]
 ├── raw_status          — the jurisdiction's own status string,
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
 ├── role                — 'primary_sponsor' | 'cosponsor'   [aggregator]
 └── source_item         — FK → CollectedItem, required — this was
                            missing before; every other government-record
                            table has one, and sponsorship is a factual
                            assertion about a named person with no review
                            gate, so it shouldn't be the exception  [aggregator]
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
 ├── date_made                                                    [aggregator]
 ├── target_date         — nullable, if the promise itself named a
 │                          deadline (e.g. "by end of my first term")
 │                                                                  [aggregator]
 ├── fulfillment_status  — 'not_yet_due' | 'in_progress' | 'fulfilled' |
 │                          'broken' | 'partially_fulfilled' | 'stalled'
 │                                             [processor: promise-tracking]
 └── fulfillment_locked  — see "Review & audit" below              [admin GUI]
```

```
PromiseSource
 ├── promise_id      — FK → Promise
 ├── source_item_id  — FK → CollectedItem
 └── relation        — 'primary' | 'supporting'
```

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
`[processor: statement-similarity]`

```
PromiseEvidence                    — what fulfillment_status is based on.
                                      Originally designed as a polymorphic
                                      evidence_type/evidence_id pair,
                                      accepting the loss of a real FK as
                                      the cost of covering heterogeneous
                                      evidence types — but with exactly
                                      four known types and no plan for
                                      more, four nullable FKs with a check
                                      constraint (exactly one non-null)
                                      gets the same flexibility *and* real
                                      referential integrity, for free.
                                      Corrected rather than kept as a
                                      deliberate tradeoff — a dangling
                                      evidence_id after a Bill gets
                                      deleted/merged, silently rendering
                                      on a promise page, wasn't actually a
                                      cost worth paying
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
                        agreeing evidence; same gap as the old
                        supporting/contradicting split on Claim, just
                        caught this time before it shipped instead of
                        after
```
`[processor: promise-tracking]`

### Votes

```
Vote                                — the roll-call event itself, not any
                                       one politician's vote on it
 ├── jurisdiction_id     — FK → Jurisdiction                  [aggregator]
 ├── chamber_id          — FK → Chamber                        [aggregator]
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
 ├── vote_stage          — e.g. 'committee' | 'third_reading' |
 │                          'final_passage' (jurisdiction-defined)
 │                                                              [aggregator]
 ├── result              — 'passed' | 'failed'                [aggregator]
 ├── yea_count / nay_count / other_count                       [aggregator]
 └── source_item                                                [aggregator]
```
`UNIQUE (jurisdiction_id, external_vote_id)`.

```
VoteRecord                          — one politician's vote on one Vote
 ├── vote_id             — FK → Vote                          [aggregator]
 ├── politician_id       — FK → Politician                    [aggregator]
 ├── value               — normalized enum: 'yea' | 'nay' | 'present' |
 │                          'absent' | 'excused'                [aggregator]
 ├── raw_value           — the jurisdiction's own value string,
 │                          unnormalized                        [aggregator]
 └── source_item                                                 [aggregator]
```

### News & social

```
NewsItem / SocialPost
 ├── platform            — 'news' | 'x' | 'facebook' | 'instagram' |
 │                          'rss' | 'other'                     [aggregator]
 ├── canonical_url       — the article/post's own URL — distinct from
 │                          whatever CollectedItem.source_url the fetch
 │                          came through (a GDELT-sourced item's fetch URL
 │                          is a GDELT record, not the article itself);
 │                          Stage 8 already said this field existed, it
 │                          just hadn't actually been added here yet
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
No `duplicate_of` — it was a third, contradictory dedup mechanism: the
aggregator already catches exact duplicates *before* writing a new row
(using this same `content_hash`), so there's no second row for
`duplicate_of` to point at in the normal case, and `NewsItemRelation`
already exists for the residual case (two rows that exist because they
looked different enough to both get written, but a processor later
decides they're the same/near-same article). One mechanism, not two —
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

```
NewsItemRelation                   — same shape as ClaimRelation, for
                                      duplicates/near-duplicates instead
                                      of restatements
 ├── news_item_a_id  — FK → NewsItem/SocialPost
 ├── news_item_b_id  — FK → NewsItem/SocialPost
 └── relation_type   — 'exact_duplicate' | 'possible_near_duplicate'
```
`[processor: near-duplicate detection]`

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
`[processor: entity-resolution]`

### Review & audit

An independent review of this schema found that three separate features
already in this spec — the Stage 4 admin review queue, the per-profile
"report an error" channel, and the Stage 11 legal-review gate — all assume
a human can correct something, but nothing in the schema recorded that a
correction happened. Concretely: an operator manually sets a `Claim` to
`DISPUTED_BY_SOURCE` after reviewing a complaint, and without a lock, the
next processor re-run (or any re-run triggered by a new `model_version`)
silently recomputes it back. Same problem for a rejected entity-resolution
match or a flagged `CollectedItem` — it just gets re-flagged forever and
the review queue never actually drains.

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
 │                        'politician_alias' | 'collected_item'
 ├── target_id
 ├── field_changed
 ├── previous_value
 ├── new_value
 ├── reason           — nullable
 ├── actor            — the admin identity (Stage 4)
 └── created_at
```
`[admin GUI]` — written whenever an admin action changes a field that
also has a `locked`/`verification_locked`-style flag; the write and the
lock happen together, not as two separate steps that could drift apart.

**Retraction & suppression.** `Claim`/`NewsItem` above both got
`is_suppressed`/`suppressed_at`/`suppression_reason` fields — soft
suppression, not `DELETE`, specifically so the provenance trail (useful
for a legal defense, not just an offense) survives a takedown. `DELETE`
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
 ├── news_item_id           — FK → NewsItem/SocialPost, required. The
 │                             prose always said Claim was "layered on
 │                             top of NewsItem/SocialPost" but this FK
 │                             was actually missing — without it there's
 │                             no way to navigate from a claim back to
 │                             the article/post it came from (needed for
 │                             Stage 5's "Claims & allegations" next to
 │                             "Source material" on the same page), or
 │                             re-run extraction scoped to one item
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
 ├── model_version           — which extraction/summarization pass
 │                             produced this row
 └── generated_summary       — the claim-preserving summary, not a bare
                                assertion
```

No inline `target` (was a plural field with no way to actually join on
it — the exact array-column problem fixed everywhere else in this
section, missed here in the earlier pass) and no `target_response` (was a
single FK to an unspecified table, wrong cardinality in both directions —
one statement often rebuts several claims, one claim can get more than
one response over time). Both become join tables:

```
ClaimTarget                        — politician(s) a claim is about
 ├── claim_id         — FK → Claim
 ├── politician_id    — FK → Politician
 └── confidence       — 'confirmed' | 'inferred' (mirrors NewsItemPolitician)
```

```
ClaimResponse                      — replaces target_response; a
                                      politician's statement addressing a
                                      claim, explicitly typed rather than
                                      an unspecified FK, and multi-valued
                                      in both directions
 ├── claim_id           — FK → Claim
 ├── response_type       — 'news_item' | 'claim' (a response is itself
 │                          either a NewsItem/SocialPost or another Claim
 │                          — e.g. a follow-up statement that itself gets
 │                          claim-extracted)
 ├── response_id         — the referenced row's ID, per response_type
 └── stance              — 'denies' | 'confirms' | 'clarifies'
```
`[processor: claim extraction]` for both.

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

```
ClaimRelation                      — links two Claims a processor thinks
                                      assert the same underlying thing,
                                      without merging them
 ├── claim_a_id      — FK → Claim
 ├── claim_b_id      — FK → Claim
 └── relation_type   — 'possible_restatement'
```
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

**Section 230 caveat:** Section 230 protects hosting someone else's
speech, but the site's own AI-generated claim extraction, normalization,
and summaries are the site's own output — the more the pipeline
transforms third-party material into new substantive text, the less that
output can be assumed to inherit third-party protection. This is exactly
why the claim-preserving pipeline (attribute, don't assert) matters
operationally, not just as a disclaimer.

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
- Every `Claim` has exactly one `ClaimSource` with `relation: 'primary'`
  — verify the partial unique index is real, not aspirational.
- Attempting to insert a `Claim`/`Promise` with zero source rows fails at
  the DB layer, not just gets caught later by app logic.

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
  cross-cutting decision #7) still boots and lets an admin build a
  complete profile by hand — exercise this end to end, since it's
  currently only modeled.
- A Stage 6 comparison view can be added or removed by touching one file
  — proves the presenter layer is actually modular, not just documented
  as such.

**Pipeline-layer boundary enforcement** — the sharpest gap the
independent schema review found:
- The `[aggregator]`/`[processor: X]` tagging convention used throughout
  "Aggregator output schema" is currently pure documentation — nothing
  stops an aggregator code path from writing `verification_status`.
  Requires a real decision, not left implicit: either enforce it
  (separate service-layer write functions, or DB-level column grants) or
  explicitly accept it as a code-review convention only.
- Presenter code contains zero direct DB queries (cross-cutting decision
  #5) — checkable with a lint rule banning ORM calls outside the service
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

## Staging notes

Everything below is a full replan, not a renumbering — the original
9-stage plan was written before the four-layer pipeline, the collector
architecture, the full "Aggregator output schema," the claim-preserving
model, the admin GUI, and the review/audit/suppression system existed.
Folding all of that into the old Stage 1 and Stage 5 made both
unreviewable as single units. This plan is deliberately smaller and more
numerous, so each stage maps to one thing in "Validation & acceptance
criteria" above that can actually be checked before moving on — and
because the schema is provenance-first from Stage 1, this plan should be
the last one; the intent is that new features are new stages appended to
this list, not migrations of what's already built.

Two structural choices worth calling out rather than leaving implicit:
- **Schema is split into two stages along the same line "Editorial
  stance" already draws** — government records (Stage 1) vs. everything
  claim-bearing (Stage 2) — rather than one giant schema stage, since
  that's the natural seam and keeps each stage's migration reviewable.
- **A real deployment/ship checkpoint (Stage 7) sits in the middle of
  this plan, not just at the end.** Everything through Stage 7 is
  primary-source-only — no LLM, no crawler, no legal exposure — so it's a
  genuinely shippable product on its own per cross-cutting decision #7,
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
- `CollectedItem` provenance envelope, including `intake_locked` (same
  reasoning as `PoliticianAlias.locked` — built with the table, not
  retrofitted).
- TypeScript interfaces for all four pipeline layers (`Collector`,
  `Aggregator`, `Processor`, `Presenter` — see "Four-layer modular
  pipeline"), plus a stub/mock `JurisdictionAdapter` with fake data so
  Stage 3+ has something concrete to implement against and Stage 5's UI
  can be built in parallel against mock data.

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

**Verification:** unit tests on the schema, including the constraints
that matter most here specifically — inserting a `Claim` with zero
`ClaimSource` rows fails; exactly one `ClaimSource` per claim can have
`relation: 'primary'`.

---

## Stage 3 — Pilot-state government data ingestion

**Build:**
- Research task first: confirm what the pilot state's legislature
  actually exposes via API/structured data — an assumption, not a
  confirmed fact yet.
- Real `JurisdictionAdapter` for the pilot state: jurisdiction/chamber/
  session/district seeding, legislator roster, bill list, roll-call
  votes, term info. This is the first real API-poller collector, and
  where the worker service (cross-cutting decision #6) and its
  scheduling/alerting/politeness requirements first get built, not
  retrofitted later. Reference implementation, not a hard requirement for
  every deployment — decision #7 still allows manual-upload-only.
- Manual upload collector, built alongside the poller so it's a genuinely
  supported path from the start: any record type above can come from a
  human submission instead of the API, through the same validation gate.
- Scheduled ingestion job (in-process scheduler in the worker service)
  syncing polled data into Postgres via the aggregator.

**Key decisions to confirm:** none yet beyond the research outcome —
report back with what the API actually gives before locking the
adapter's shape.

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
- `CollectorJob` table unifying scheduled *and* manually-triggered runs
  into one history. Also replaces the informal "last-successful-poll"
  health tracking from "Data collector architecture" — that's now just
  "the most recent succeeded `CollectorJob`."
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
- Auth: [DECISION TO CONFIRM] single admin credential (env var) + session
  cookie for now, not a full multi-user system — upgradeable later
  without touching the rest of the architecture.
- Collector enable/disable (decision #7): [DECISION TO CONFIRM] runtime
  admin toggle (DB-backed) in addition to deploy-time env var, with the
  env var setting the initial state? Leaning yes, flagging since it
  extends decision #7 beyond deploy-time-only.

**Verification:** admin can log in, see the pilot state's collectors
listed, trigger a manual poll run and watch pending → running →
succeeded, and submit a manual upload that reaches Postgres via the same
aggregator path as everything else.

---

## Stage 5 — Politician profile pages

**Build:**
- Profile page: photo, bio, current office/district, voting record,
  sponsored bills — Stage 3 data only, all primary-source, no review gate
  needed. Fetched via service functions (`getPoliticianProfile(id)`,
  etc.), never inline DB queries in the page component (decision #5) —
  this is the stage that habit starts in.
- Page section skeleton now, even though only "Verified facts" has
  content until Stage 10: *Verified facts | Claims & allegations |
  Responses | Analysis/opinion | Source material* (per "Claim-preserving
  content model"). Avoids retrofitting the layout once claims arrive.
- Lightweight "report an error" link (routes to an issue/email, not a
  moderation queue) — accountability sites get factual pushback and need
  *some* channel for it even under an automation-first policy.

**Key decisions to confirm:**
- Bio text source: likely scraped HTML from the legislature's own site,
  not an API — first scraping target under the "hybrid, case by case"
  sourcing decision. Confirm that's acceptable (public official bios on a
  government site, low risk) vs. asking before scraping even this.

**Verification:** every seated legislator in the pilot state has a
working profile page with real name/district/votes; spot-check 5-10
against official sources.

---

## Stage 6 — Comparison & visualization modules

**Build:** the data presenter layer's initial modules:
- Radar chart: issue-area stance per politician (vote record ×
  issue-area tagging from Stage 1).
- Voting alignment %: any two politicians, or politician vs. party
  majority.
- Issue-area scorecard: tabular breakdown by topic.
- Peer leaderboard: bills sponsored, attendance rate, bipartisanship
  score, scoped to one chamber.

**Deferred:** the "stated priorities vs. actual voting record" and
"promises vs. actions" *views* — see Stage 13. The underlying data isn't
actually blocked (an admin can enter `Promise`/`PoliticianPriorityIssue`
rows by hand starting Stage 4), it's specifically the comparison
presenter for that data that waits, so it isn't built against an empty
table.

**Key decisions to confirm:** radar chart axes = the issue-area taxonomy
from Stage 1 — needs to be settled before this stage starts.

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
  a theoretical one per decision #7.

**Verification:** a clean checkout + `docker compose up` produces a
working site with no manual steps beyond env vars/API keys — and directly
exercises the "Fork-ability" checks in "Validation & acceptance
criteria": the manual-upload-only deployment actually boots and lets an
admin build a complete profile by hand, end to end, not just in theory.

---

## Stage 8 — News & social collectors + aggregator normalization

First stage that touches third-party content, but not yet claims —
collection and normalization only. Per decision #7, none of this runs
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
the disclaimer's wording/placement (Stage 12), the suppression/retraction
process (Stage 10), and the non-defamation areas already flagged
(copyright, platform ToS, privacy, election law).

**Verification:** the sign-off exists as an artifact (not just "we talked
about it") before Stage 8-10's features are enabled in any
publicly-reachable deployment.

---

## Stage 12 — AI summaries + sitewide disclaimer

**Build:**
- AI-generated summaries as the last step of the claim-preserving
  pipeline (`Claim.generated_summary`), not a standalone
  LLM-over-raw-text pass — describes the *conversation* around a claim
  (who said what, whether disputed, what corroboration exists), not the
  claim restated as fact.
- One sitewide disclaimer (persistent footer notice + dedicated
  `/about/disclaimer` page), explained once. Each AI-summarized block
  gets a badge linking to it — the disclaimer explains the system, it
  doesn't substitute for the claim-preserving pipeline being careful,
  which is what's actually doing the defamation-risk mitigation.

**Key decisions to confirm:** which LLM/summarization approach fits
"free/near-free" — likely a cheap small model or a strict
summarization budget/cache rather than summarizing on every page load.

**Verification:** manual review of 10+ AI summaries against their source
claims, confirming none upgrade a hedged/attributed claim into a bare
assertion; disclaimer badge present on every AI-summarized item.

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

## Open items not yet scheduled

- Additional state adapters beyond the pilot state (explicitly optional
  per your answer — "may expand... but may not").
- Contributor docs for someone else standing up their own jurisdiction
  adapter (natural follow-up once 2 adapters exist and the interface has
  proven itself against real, different data shapes).

---

## Next step

Stage 0 is partway done: `CLAUDE.md` is rewritten, `README.md` exists, and
the git-safety hook (`.claude/hooks/git-safety-guard.mjs`) is live and
tested. Still open in Stage 0: the actual app scaffold and CI. Stage 1 is
next — its two [DECISION TO CONFIRM] items (Stage 4's auth mechanism and
runtime collector toggle) are actually Stage 4 decisions, not Stage 1
ones; Stage 1 itself has only the issue-area taxonomy call to confirm
before it starts.
