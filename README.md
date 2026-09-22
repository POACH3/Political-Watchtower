# Political Watchtower

A politically focused aggregator to provide voters/citizens a low-friction way to see who represents them, what those
representatives have actually done (votes, sponsored bills, news
coverage), and how they compare to their peers.

## Goals

- **Primary-source first.** Voting records, bill sponsorships, and
  committee membership come from official government data and publish
  automatically, with a source link on every item.
- **Narrative content is clearly labeled.** Bios, news articles, social media posts, and any
  AI-generated summaries always link back to their original source/author
  and are marked as narrative, not primary-source fact.
- **Promises and Actions.** Verifiable (sources linked) promises and whether or not they have been completed listed for each individual.
- **Nonpartisan.** This is an accountability tool, not an advocacy
  platform — the same treatment applies regardless of party.
- **Built to be forked.** Codebase is designed so anyone in another state (or country) can point it at their own legislature without too much of a hassle.

## How it's structured

Four main components:  
- **Data collectors:** A collection of modules that can be selected.
- **Data aggregator:** A modular interface that aggregates data from multiple sources (APIs, webscraping, upload, etc.).
- **Data processors:** A collection of modules that can be selected. Each can take the aggregated data and distill it into useful pieces of information.
- **Data presenter:** Modular interface that accepts any type of data processor. Easily digestible and honest views of the results with links to primary sources. Includes data visualizers, filters, and text summaries.

The core app is jurisdiction-agnostic. Each jurisdiction (state
legislature, US Congress, and eventually others) implements a common
"jurisdiction adapter" interface — fetch legislators, fetch votes, fetch
bills, fetch news — so the app itself never hardcodes assumptions about
any one state's data source. Comparison and visualization features (radar
charts, voting-alignment scores, issue scorecards, leaderboards) are
similarly built as independent, swappable modules rather than one fixed
page, so views can be added or removed without touching the others.

Full architecture decisions and the stage-by-stage build plan live in
[SPEC.md](SPEC.md).

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

## Running it / deploying your own fork

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
- **Pointing your fork at your own state:** once the `JurisdictionAdapter`
  interface lands (SPEC.md Stage 1) and has been proven against two real
  jurisdictions, adding a new state will mean implementing that interface
  — no core app changes. Concrete steps will replace this note once that's
  true (see "Contributing" below).

### Contributing / adding your own jurisdiction

Not yet ready for external contributions — the jurisdiction adapter
interface hasn't been built yet (see SPEC.md Stage 1). Once it exists and
has been proven against two real, differently-shaped data sources (a
state legislature and US Congress), this section will cover what it takes
to add a new state.

## Repo guardrails

See [CLAUDE.md](CLAUDE.md) for the working rules this repo enforces
(what needs sign-off, what's hard-blocked at the git level, etc).


## Project Info
**Status:** early-stage/pre-code. See [SPEC.md](SPEC.md) for build plan.  
**Language:** TypeScript  
**License:** [AGPL-3.0](./LICENSE.txt)  
**Authors:** [POACH3](https://github.com/POACH3)    
**Start Date:** 22-SEP-2026