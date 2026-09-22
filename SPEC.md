# Political Watchtower — Project Spec

## Goal

Give voters a fast, low-friction way to see who represents them, what those
representatives have actually done (votes, sponsored bills, news coverage),
and how they compare to peers — so people can vote informed without doing
hours of their own research.

**Pilot jurisdiction:** Utah State Legislature (House + Senate).
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
actual legal counsel. Recommend a real legal review gate before Stage 5
ships publicly, since that's the first stage introducing third-party
claims about real people at any volume. Not blocking Stages 0-4, which are
government-records-only.)*

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
   fork; (b) the comparison/scorecard features (Stage 4) need real
   relational queries across politicians × votes × issue areas, which
   Postgres handles far better than a document store; (c) it has broad
   free-tier hosting options (Vercel free tier, Neon/Supabase free Postgres,
   or self-hosted via Docker) fitting the "free/near-free for now" budget.
   SQLite is the fallback if you'd rather start with zero external
   dependencies for local dev — happy to use it for Stage 0-2 and swap
   later if that's preferred, but Postgres is the better default given the
   comparison-heavy feature set.
3. **"Jurisdiction adapter" plugin architecture.** Each jurisdiction (Utah
   legislature, US Congress, future states) implements a common interface
   (`fetchLegislators`, `fetchVotes`, `fetchBills`, `fetchNews`, ...). The
   core app only knows about the interface, not the specifics of any one
   state's data source. This is what makes "point it at your own state"
   realistic for other adopters.
4. **Modular "views" system for comparisons/visualizations.** Per your
   request, each comparison view (radar chart, voting-alignment %,
   issue-area scorecard, peer leaderboard, promises-vs-actions) is a
   self-contained module registered against the core data model, not
   hardcoded into a single page — new views can be added or removed without
   touching the others.

---

## Claim-preserving content model (defamation-resistant architecture)

This section governs anything in Stage 5+ (news, social content, AI
summaries) — the parts of the site describing what someone *said* about a
politician, as opposed to Stages 1-4's government records. It exists
because attribution alone ("according to a post...") doesn't automatically
protect a publisher from liability for repeating someone else's
defamatory claim, and while public officials generally have to clear a
high bar (actual malice) to win a defamation suit over official conduct,
that protection isn't something to build the whole system's safety around
— it can vary by jurisdiction, by whether the target counts as a public
figure for the specific statement at issue, and Utah in particular applies
a different, lower fault standard for private individuals who might get
swept into scraped content. None of this is legal advice; it's the
engineering response to that risk, and a real legal review is still the
plan before Stage 5 ships (see Editorial stance above).

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
against in Stage 6.

**Data model — `Claim`, a new entity for Stage 1**, layered on top of
`NewsItem`/`SocialPost` (which stays as the raw-content record: the actual
post/article, author, timestamp, URL, platform). A `Claim` is a specific
attributed statement extracted from that raw content:

```
Claim
 ├── exact_text            — the original wording, unmodified
 ├── normalized_claim      — a neutral paraphrase for display/search
 ├── claimant              — who said it
 ├── target                — politician(s) the claim is about
 ├── source_item           — FK to the originating NewsItem/SocialPost
 ├── publication_timestamp
 ├── retrieved_timestamp
 ├── verification_status
 ├── supporting_sources[]
 ├── contradicting_sources[]
 ├── target_response       — FK to a response item, if one was matched (best-effort, see Stage 5)
 ├── model_version          — which extraction/summarization pass produced this row
 └── generated_summary      — the claim-preserving summary, not a bare assertion
```

`verification_status` is a **descriptive enum, not a truth score** (a
single AI-generated "94% corrupt" number is its own liability risk — see
below):

- `UNVERIFIED_CLAIM` — default for anything not yet checked against
  another source.
- `SUPPORTED_BY_PRIMARY_SOURCE` — corroborated by Stage 2/8 government
  records (e.g. a campaign-finance claim that matches an actual filing).
- `CORROBORATED` — independently reported by more than one source.
- `CONTRADICTED` — a source disputes or denies it (this is where
  `target_response` normally lands).
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

**Sentiment analysis, if it ships as a view (Stage 4/6):** label it as
*"sentiment expressed in this source"*, never *"sentiment toward
[politician]"* — the latter reads as the site asserting something about
the politician rather than describing the text. Keep author sentiment,
commenter sentiment, and model-detected sentiment as distinct, separately
labeled values, and never collapse a sentiment score into a
crime-implying metric like a "corruption score."

**Content organization (Stage 3 profile pages):** organize claim-bearing
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
before Stage 5 ships**, beyond defamation: copyright (how much of an
article gets reproduced vs. linked), platform terms of service for
scraping/embedding, privacy (avoiding data collection on private
individuals who aren't the political figures being profiled), false
light and related state-law claims, election-law exposure if the project
ever becomes affiliated with a campaign/PAC/political ad, and AI-
disclosure/consumer-protection rules depending on how the site markets
itself. Utah-specific defamation privilege and the public/private-figure
fault-standard split should be part of that same review given the pilot
jurisdiction.

---

## Stage 0 — Repo foundations

**Build:**
- Rewrite `CLAUDE.md` to reflect this project (jurisdiction-agnostic,
  no-IaC, automation-first editorial policy, real guardrails like "don't
  commit a profile without sources").
- Scaffold the app (Next.js + TypeScript + Postgres via Docker Compose for
  local dev), basic README explaining the "add your own jurisdiction"
  story for other adopters.
- CI: lint + typecheck + test on push (GitHub Actions), no deploy step yet.

**Key decisions to confirm:**
- Next.js + Postgres, per architecture decision #2 above — confirm or
  redirect.

**Verification:** app boots locally via `docker compose up`, shows a
placeholder homepage, CI passes on an empty test suite. No real data yet.

---

## Stage 1 — Core data model + jurisdiction adapter interface

**Build:**
- Schema: `Politician`, `Office`/`Term`, `Bill`, `Vote`, `VoteRecord`
  (politician × bill × vote value), `IssueArea` (tag for bills/votes),
  `NewsItem`/`SocialPost` (raw source content: `sourceUrl`, `author`,
  `publicationTimestamp`), and `Claim` (see "Claim-preserving content
  model" above) — defined now even though it isn't populated until
  Stage 5, so the schema is claim-aware from the start rather than
  bolted on later.
- Define the `JurisdictionAdapter` TypeScript interface and a stub/mock
  adapter with fake data, so Stage 2+ has something concrete to implement
  against and the UI in Stage 3 can be built in parallel against mock data.

**Key decisions to confirm:**
- Issue-area taxonomy: fixed list (e.g. healthcare, education, taxes,
  public safety, environment...) vs. free-form tags derived from bill
  subjects as scraped from the state. Recommend starting with a small fixed
  list (~10-15 areas) for the radar chart to be readable, and tagging bills
  into it via keyword/subject-code mapping — can go smarter (ML
  classification) later.

**Verification:** unit tests on the schema + a working mock adapter that
the UI can render against; no external calls yet.

---

## Stage 2 — Utah legislature data pipeline (primary sources only)

**Build:**
- Research task first: confirm what Utah's legislature actually exposes.
  Utah (`le.utah.gov`) has historically published bill/vote data in
  structured form (XML/JSON feeds) — needs verification before building
  against it, since this is an assumption, not a confirmed fact.
- Implement the real `UtahJurisdictionAdapter`: legislator roster, bill
  list, roll-call votes, committee membership, term info.
- Scheduled ingestion job (cron or manual trigger) that syncs this into
  Postgres.

**Key decisions to confirm:**
- None yet beyond the research outcome — this stage's real first step is
  "figure out what Utah's API actually gives us" before locking the
  adapter's shape. I'll report back with what's available before writing
  the ingestion code.

**Verification:** ingestion job run against real Utah data populates the
DB with a plausible number of legislators (Utah has 104: 75 House + 29
Senate) and their recent votes; spot-check a handful of records against
the legislature's own website for accuracy.

---

## Stage 3 — Politician profile pages

**Build:**
- Profile page: photo, bio, current office/district, voting record list,
  sponsored bills — all from Stage 2 data, all primary-source so no review
  gate needed.
- Lay out the page's section structure now even though only "Verified
  facts" has content until Stage 5: *Verified facts | Claims & allegations
  | Responses | Analysis/opinion | Source material* (per "Claim-preserving
  content model" above). Building the skeleton now avoids retrofitting the
  page layout once claims start flowing in.
- A lightweight "report an error" link on each profile (routes to an
  issue/email, not a moderation queue) — accountability sites get factual
  pushback and need *some* channel for it even under an automation-first
  policy.

**Key decisions to confirm:**
- Bio text source: Utah's legislature site likely has short official bios
  per member, but that's scraped HTML, not an API — first scraping target
  under the "hybrid, case by case" sourcing decision. Confirm that's an
  acceptable use (public official bios on a government site, low risk) vs.
  waiting and asking you before scraping even this.

**Verification:** every seated Utah legislator has a working profile page
with real name/district/votes; manually spot-check 5-10 profiles against
official sources.

---

## Stage 4 — Comparison & visualization modules

**Build:** the modular views system, with initial modules:
- Radar chart: issue-area stance per politician (derived from vote record
  × issue-area tagging from Stage 1).
- Voting alignment %: any two politicians, or politician vs. their party's
  majority position.
- Issue-area scorecard: tabular breakdown by topic.
- Peer leaderboard: bills sponsored, attendance rate, bipartisanship score,
  scoped to one chamber.

**Deferred to a later stage:** "promises vs. actions" — this needs curated
campaign-statement data (platforms, debate quotes), which is a distinct,
more subjective data-sourcing problem than pure voting records. Calling
this out now so it isn't assumed to ship alongside the others.

**Key decisions to confirm:**
- Radar chart axes = the issue-area taxonomy from Stage 1; confirms that
  decision needs to land before this stage starts.

**Verification:** each view renders correctly against real Stage 2/3 data
for at least 3 sample politicians with meaningfully different voting
patterns (to sanity-check the visualizations aren't flat/meaningless).

---

## Stage 5 — News & social content (hybrid sourcing, claim extraction)

This is the first stage that publishes third-party claims about real
people — see "Claim-preserving content model" above for the architecture
this stage implements, and the legal-review recommendation before it
ships publicly.

**Build:**
- News: free-tier source — recommend RSS from known Utah news outlets +
  GDELT (free, no rate-limit issues) over NewsAPI's free tier (restricted
  to non-commercial/delayed use, poor fit for a public site).
- Social: official oEmbed (X/Twitter, Facebook, Instagram support some
  form) rather than scraping profiles directly — avoids ToS risk. Falls
  back to a manually-curated link list per politician where no
  embeddable/official option exists (case-by-case, per your "hybrid"
  answer).
- Every `NewsItem`/`SocialPost` stores `sourceUrl` + author + a content
  hash (not a full-text mirror — see provenance-storage decision above),
  linking back to the original.
- Claim extraction: parse each item into zero or more `Claim` rows
  (exact text, claimant, target, initial `verification_status` —
  defaults to `UNVERIFIED_CLAIM`, or `SUPPORTED_BY_PRIMARY_SOURCE` when
  it can be directly matched against Stage 2 vote/bill records).
- Best-effort `target_response` matching: if the profiled politician has
  their own post/statement addressing a claim, link it as the response
  and set status to `CONTRADICTED` or `CORROBORATED` accordingly. This is
  heuristic, not guaranteed-complete — a claim with no matched response
  just stays `UNVERIFIED_CLAIM`, it doesn't imply the target didn't
  respond somewhere.

**Key decisions to confirm:**
- Confirm RSS + GDELT over a paid news API given the free-tier budget
  constraint.
- Which Utah outlets to pull RSS from — I'll propose a list (Salt Lake
  Tribune, Deseret News, KSL, Utah News Dispatch, etc.) for you to approve
  before wiring them in, since it shapes what coverage looks balanced.
- Confirm hash + excerpt + link over full-text storage (provenance
  decision above).

**Verification:** profile pages show a live, reasonably fresh (< 1 week
old) feed of real news/social items for a handful of high-profile Utah
legislators, each rendered as an attributed claim with a visible
`verification_status`, not as an unqualified statement; spot-check that
the extraction pipeline hasn't upgraded any hedge language ("accused of",
"alleged") into a bare assertion.

---

## Stage 6 — AI summaries + sitewide disclaimer

**Build:**
- AI-generated summaries of long bills/news clusters, built as the last
  step of the claim-preserving pipeline (`Claim.generated_summary`), not
  a standalone LLM-over-raw-text pass. The summary describes the
  *conversation* around a claim — who said what, whether it's disputed,
  what corroboration exists — rather than restating the claim as
  established fact. E.g. "Several posts alleged X; the claim originated
  with Y; Z denied it; no independent corroboration was found in sources
  reviewed" — not "X happened, according to several posts."
- One prominent, sitewide disclaimer (e.g. persistent footer notice +
  dedicated `/about/disclaimer` page) explaining the methodology once,
  per your "provide once, highly visible" preference. Each AI-summarized
  block still gets a small badge/icon linking to that page — but per
  "Claim-preserving content model" above, the disclaimer is not what's
  doing the defamation-risk mitigation here; the claim-preserving
  pipeline and per-claim `verification_status` are. The disclaimer
  explains the system; it doesn't substitute for the system being
  careful. (Still worth a real legal check on the disclaimer's wording
  and placement — not something I can certify.)

**Key decisions to confirm:**
- Which LLM/summarization approach, and whether it's in-budget at "free/
  near-free" — likely means a cheap small model or a strict summarization
  budget/cache rather than summarizing on every page load.

**Verification:** manual review of 10+ AI summaries against their source
claims, specifically checking that none of them upgrade a hedged/attributed
claim into a bare assertion; disclaimer badge visibly present on every
AI-summarized item; spot-check `verification_status` values are
justified by what's actually in `supporting_sources`/`contradicting_sources`.

---

## Stage 7 — Deployment

**Build:**
- `docker-compose.yml` for one-command self-hosting.
- Deployment docs for AWS without IaC (App Runner or Amplify Hosting via
  console) since you're open to AWS for cloud hosting.
- Generic Docker deployment docs (Fly.io/Render/Railway) for other
  adopters who don't want AWS.

**Key decisions to confirm:** none anticipated — this stage just needs the
app from Stages 0-6 to already work, which is why it's last before scope
expansion.

**Verification:** a clean checkout + `docker compose up` produces a
working site with no manual steps beyond setting env vars/API keys.

---

## Stage 8 — US Congress expansion

**Build:** a second `JurisdictionAdapter` (`CongressJurisdictionAdapter`)
using Congress.gov's official API (free, requires an API key) for
legislators, bills, and roll-call votes.

**Key decisions to confirm:**
- Confirm Congress.gov API over ProPublica's Congress API — ProPublica's
  has had availability issues; Congress.gov is the official, currently
  maintained source, so it's the safer default.

**Verification:** same bar as Stage 2, applied to a sample of the 535
members of Congress.

---

## Open items not yet scheduled

- Additional state adapters beyond Utah (explicitly optional per your
  answer — "may expand... but may not").
- Contributor docs for someone else standing up their own jurisdiction
  adapter (natural follow-up once 2 adapters exist and the interface has
  proven itself against real, different data shapes).

---

## Next step

Stage 0 is partway done: `CLAUDE.md` is rewritten, `README.md` exists, and
the git-safety hook (`.claude/hooks/git-safety-guard.mjs`) is live and
tested. Still open in Stage 0: the actual app scaffold (Next.js +
TypeScript + Postgres via Docker Compose) and CI. Confirm or redirect the
`Claim` data model and verification-status enum above before Stage 1
starts, since Stage 1's schema is where they get implemented.
