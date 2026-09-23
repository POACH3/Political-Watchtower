# Political Watchtower

A politically focused aggregator to provide voters/citizens a low-friction way to see who represents them, what those
representatives have actually done (votes, sponsored bills, news
coverage), and how they compare to their peers.

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
rely on manual upload alone. An admin interface (pre-code, like
everything else here) is where an operator triggers collector runs,
uploads data by hand, and reviews flagged content.

Full architecture decisions and the stage-by-stage build plan live in
[SPEC.md](SPEC.md).

## Data model

Everything ties back to a `Politician` — a person, not just an
officeholder, so a first-time candidate who's never won an election is
represented the same way as an incumbent:

- **Jurisdictions & elections** — `Jurisdiction`, `Chamber`,
  `LegislativeSession`, `District`, `Election`, `Candidacy`. What someone
  ran for and where, independent of whether they won.
- **People & positions** — `Politician`, `Term`, plus alias/external-ID
  tracking so the same person doesn't fork into duplicate profiles across
  sources or jurisdictions.
- **Legislation** — `Bill`, `Vote`, `VoteRecord`, `IssueArea` — primary-
  source government records, published automatically since the source
  itself is the verification.
- **Promises & priorities** — `Promise` (with fulfillment tracking) and
  self-reported priority issues, kept separate from voting-derived issue
  alignment so stated priorities can be compared against actual votes.
- **News & claims** — `NewsItem`/`SocialPost` for raw content, `Claim` for
  specific attributed statements extracted from it. A claim is never
  asserted as true by the site itself — each one carries its own
  verification status, its sources, and a link back to where it came from.
- **Provenance & review** — every piece of collected data traces back to
  a `CollectedItem` (what was fetched, from where, when); anything a
  human corrects gets logged so an automated pipeline run can't silently
  overwrite the correction.

Full field-level schema — every table, relationship, and constraint —
lives in SPEC.md's "Aggregator output schema" and "Claim-preserving
content model" sections.

## Tech stack

- **Framework:** Next.js (TypeScript) — one deployable unit, no separate
  frontend/backend repos to keep in sync.
- **Database:** Postgres — the comparison/scorecard features need real
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

**Status: pre-code** — none of this is buildable yet (see SPEC.md Stage 0).
This section describes the intended shape once it lands, so forkers know
what to expect:

- **Local dev:** `docker compose up` will bring up the app and a Postgres
  instance together — no separate DB install needed. Config (DB
  connection, any third-party API keys) will be read from a `.env` file,
  with a checked-in `.env.example` documenting what's required.
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
**Status:** early-stage/pre-code. See [SPEC.md](SPEC.md) for build plan.  
**Language:** TypeScript  
**License:** [AGPL-3.0](./LICENSE.txt)  
**Authors:** [POACH3](https://github.com/POACH3)    
**Start Date:** 22-SEP-2026