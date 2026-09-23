@CLAUDE.local.md
@AGENTS.md

## Verification of Work

Before starting any multi-step build, always include a verification plan as part of the plan itself — don't wait for me to ask for one.

## Project Structure

Always check here before assuming.

**Here's how this repo is structured:** Stages 0-2 are done (app
scaffold, government-records schema + pipeline interfaces, and the
narrative/oversight schema — Claim, Promise, NewsItem, ReviewAction).
Stage 3 (real pilot-state data ingestion) is next. What actually exists
today:

- `SPEC.md` — the project's knowledge base; see below.
- `README.md` — public-facing project overview and current status.
- `CLAUDE.md` — this file.
- `CLAUDE.local.md` — gitignored, local-only guardrail (imported into
  this file via `@CLAUDE.local.md`) explaining why jurisdiction-
  identifying details are kept out of committed docs.
- `AGENTS.md` — Next.js's own agent guidance (imported via `@AGENTS.md`),
  auto-maintained by `next dev` itself — don't hand-edit it, it gets
  regenerated.
- `.env.example` — documents every environment variable the app needs,
  each tagged with the `SPEC.md` stage that introduces it. Copy to `.env`
  (gitignored) for real local values — never commit real secrets. Note
  `DATABASE_URL` uses port 5433, not 5432 — see its comment for why
  (a locally-installed Postgres was already on 5432 on the machine this
  was built on; `docker-compose.yml`'s db service maps host port 5433 to
  the container's internal 5432 to avoid that class of conflict
  generally, not just on that one machine).
- `LICENSE.txt` — AGPL-3.0.
- `.gitignore` — also covers `CLAUDE.local.md`, `.env`, and
  `.claude/settings.local.json`.
- `.claude/` — `settings.json` (permissions, hooks config),
  `settings.local.json` (gitignored personal overrides),
  `hooks/git-safety-guard.mjs` (the PreToolUse hook backing the "Never
  do" rules below), and empty `skills/`/`rules/`/`output-styles/`
  directories (see below).
- `Dockerfile`, `docker-compose.yml` — local dev: the Next.js app +
  Postgres. Stage 3 adds a third service (the worker) once there's a
  real collector to run.
- `.github/workflows/ci.yml` — lint, typecheck, `db:migrate`, test on
  every push/PR, with its own Postgres service container. No deploy step.
- `drizzle.config.ts` — Drizzle Kit config (schema location, migrations
  output, DB credentials from `DATABASE_URL`).
- `src/app/` — Next.js App Router. Still just the Stage 0 placeholder
  homepage — no real routes/pages yet (that's Stage 5+).
- `src/db/schema/` — the full Postgres schema, both Stage 1 (government
  records: jurisdictions, people, legislation, votes, collected-items)
  and Stage 2 (narrative/oversight: news, claims, promises, review) — one
  file per `SPEC.md` subsection, re-exported from `index.ts`. Stage 1 and
  Stage 2 stay in *separate migrations* even though they're both applied
  now, per "Staging notes" in `SPEC.md`.
- `src/db/migrations/` — 3 files, one per Stage 1/Stage 2 seam "Staging
  notes" in `SPEC.md` draws, plus one cross-cutting file. Nothing has
  been deployed anywhere yet, so these are edited in place to stay
  *correct from the start* rather than layering a separate "fix"
  migration on top every time a gap gets found — see "Verification of
  Work": a gap found after the fact gets corrected in the schema file
  and the migration regenerated, not patched forward. Each generated
  file is produced straight from the current (already-correct)
  `src/db/schema/*.ts` files — nothing to regenerate through unless the
  schema itself changes again:
  - `0000_government_records_schema.sql` — Stage 1 tables (generated,
    reflecting current schema) plus the `Term` no-overlap `EXCLUDE`
    constraint (hand-written — Drizzle can't express exclusion
    constraints).
  - `0001_narrative_oversight_schema.sql` — Stage 2 tables (generated,
    reflecting current schema) plus the deferred constraint triggers
    enforcing that a `Claim`/`Promise` can't commit with zero *primary*
    source rows (hand-written — a plain FK/CHECK can't express "must
    have a row of a specific kind in another table").
  - `0002_updated_at_trigger.sql` — the shared `BEFORE UPDATE` trigger
    function + one trigger per table that has an `updated_at` column
    (hand-written); genuinely cross-cutting (spans both stages' tables),
    so it isn't folded into either stage's file.

  To regenerate `0000`/`0001` after a schema change that needs a fresh
  from-scratch migration (rather than layering a new migration on top,
  which is the normal path once something's actually deployed): comment
  out the Stage 2 exports in `schema/index.ts`, wipe
  `migrations/*.sql`/`migrations/meta/*.json`, run `npm run db:generate`
  (produces Stage 1 only), restore the Stage 2 exports, run
  `npm run db:generate` again (diffs against the Stage 1 baseline,
  producing Stage 2 only), then hand-append each stage's hand-written
  SQL block (`EXCLUDE`/triggers) with a `--> statement-breakpoint`
  separator and rename both files. Hand-written migrations (or
  hand-written content merged into a generated file) need a matching
  entry added to `migrations/meta/_journal.json` — Drizzle Kit won't
  discover a raw `.sql` file, or hand-appended content in a file it did
  generate, on its own. Only 2 snapshot files exist (`0000`, `0001`)
  even though there are 3 migrations — a snapshot only needs to exist at
  the migration index representing the latest point-in-time
  Drizzle-representable schema state; hand-written SQL (triggers,
  exclusion constraints) isn't representable in a snapshot at all, so
  `0002` needs none. Always verify a restructuring like this actually
  left the snapshot chain intact: wipe the Docker volume, run
  `npm run db:migrate` clean, then run `npm run db:generate` again with
  no further schema changes — it should print "No schema changes,
  nothing to migrate" rather than silently drifting or erroring.
  `drizzle-kit generate` itself needs a real TTY when it detects an
  ambiguous drop-one-column-add-another-in-the-same-table change (it
  prompts "created or renamed?") — run it via `expect` (auto-answering
  "create column" at each prompt) rather than piping stdin, which just
  errors with "Interactive prompts require a TTY terminal."
- `src/db/index.ts` — the Drizzle client. Only `src/lib/services/*` should
  import this — see decision #5/#8: presenters/collectors/processors call
  named service functions, never the database directly.
- `src/db/migrate.mts` — standalone migration runner (`npm run
  db:migrate`). Loads `.env` itself (`process.loadEnvFile()`) since
  nothing else does for a plain script invocation — don't remove that and
  assume `DATABASE_URL` will just be there.
- `src/lib/pipeline/types.ts` — the four pipeline-layer interfaces
  (`Collector`, `Aggregator`, `Processor`, `Presenter`) from "Four-layer
  modular pipeline." Only `Collector` has a concrete shape in use so far
  (`JurisdictionAdapter`); the others are typed contracts waiting on
  Stage 9/10/6 to implement them for real.
- `src/lib/adapters/jurisdiction-adapter.ts` — the `JurisdictionAdapter`
  interface + `mockJurisdictionAdapter` (fake data, no network calls).
  Stage 3 replaces the mock with a real pilot-state implementation; the
  interface itself shouldn't need to change to accommodate that.
- `src/lib/services/` — the shared service layer. `collected-items.ts`
  (`createCollectedItem` — upserts on the `(content_hash, source_url)`
  exact-dedup key rather than erroring or duplicating; `rawPayload` is a
  `string`, the original fetched text verbatim, never a JS object to be
  re-serialized — that broke `content_hash` integrity; `findCollectedItemByHash`),
  `jurisdictions.ts`, `politicians.ts` so far — enough to prove the
  pattern and support Stage 1/2's own tests, not a complete service layer
  for every entity yet (no `bills`/`votes`/`terms`/`claims`/`promises`/
  `news-items` service functions — those get built as later stages
  actually need to write to them, not speculatively now).
- `src/lib/test-utils.ts` — `pgErrorMessage()`: Drizzle wraps the real
  Postgres error in a `DrizzleQueryError` whose top-level `.message` is
  just `"Failed query: ..."` — the actual constraint-violation text is on
  `.cause`. Use this helper in any test asserting on a DB error message
  rather than matching `.message` directly.
- `public/` — static assets (default Next.js scaffold assets; unused ones
  haven't been cleaned up yet).
- `package.json` / `package-lock.json` — Next.js 16, React 19, Tailwind 4,
  Drizzle ORM + Drizzle Kit, Vitest. Scripts: `dev`, `build`, `start`,
  `lint`, `typecheck`, `test`, `db:generate`, `db:migrate`.
- `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`,
  `eslint.config.mjs`, `vitest.config.mts` — standard framework config.
  `vitest.config.mts` also loads `.env` and sets up the `@/*` path alias
  (Vitest doesn't pick up `tsconfig.json`'s paths automatically the way
  Next.js's own bundler does).

Stage 3 (real pilot-state data ingestion) is next. Everything past
Stage 2 — real pilot-state data, the admin GUI, presenters, processors —
doesn't exist in code yet; only the schema they'll eventually write
to/read from does.

**Here are the custom skills available and when to route to each:** none
yet — `.claude/skills/` is empty. If skills get added later, route to
them per their own descriptions; until then, work directly from `SPEC.md`
and this file rather than assuming a skill exists to delegate to.

**Here's where our knowledge base lives and how it's organized:**
`SPEC.md` is the single source of truth for architecture, data model, and
the build plan — not this file, and not memory from a past conversation.
It's organized as:
- **Design sections** (read these before touching anything they cover):
  Goal → Cross-cutting architecture decisions (numbered, referenced
  elsewhere as "decision #N") → Data collector architecture → Aggregator
  output schema (the full entity/table definitions) → Claim-preserving
  content model (the defamation-resistant design) → Validation &
  acceptance criteria → Testing strategy → Staging notes.
- **The staged build plan**: Stage 0 through Stage 15, each with a
  `Build`, `Key decisions to confirm`, and `Verification` block. Stages
  are the actual work breakdown — don't start build work that isn't
  either in the current stage or explicitly called out as safe to do
  early (e.g. schema work that's "built now even though not populated
  until Stage N").
- `CLAUDE.local.md` is a secondary, gitignored knowledge source: the
  actual pilot jurisdiction and other identifying facts kept out of
  `SPEC.md` on purpose (see that file for why).

If something isn't in `SPEC.md`, it hasn't been decided yet — flag it as
an open question rather than assuming an answer.

## Working Rules (Three Tiers)

### Always do (autopilot — no need to ask)

_(none currently — see "Ask first": no git write operation happens on
autopilot in this repo.)_

### Ask first (needs my confirmation)

- Installing or adding any external dependency, package, binary, SDK, or
  tool (`npm install`, `npx`, `pip install`, `brew install`, `curl`/`wget`
  downloads). Also enforced via `.claude/settings.json` `permissions.ask` —
  not just a reminder in this file.
- Any AWS or cloud deployment step (`aws` CLI, or manual console deploys
  to App Runner/Amplify/ECS/etc). This project intentionally avoids IaC
  tooling (no `cdk`/`terraform`/`serverless`) per SPEC.md, but any command
  that actually pushes something to a live cloud environment still needs
  sign-off regardless. Also enforced via `permissions.ask`.
- `git push` — nothing leaves the machine without explicit confirmation
  first. Hard-enforced via `permissions.ask`. (`git commit` is no longer
  in this tier — see "Never do" below: the user runs every commit
  themselves, full stop.)
- Substantive edits to SPEC.md's guardrails or stage definitions (not just
  doc formatting).
- Major dependency version bumps.
- Enabling Stage 8-10 features (crawler, claim extraction, AI content) in
  any publicly-reachable deployment without Stage 11's documented legal
  sign-off already in hand — SPEC.md states this as a hard gate multiple
  times; treat it as one here too, not just prose elsewhere.

### Never do (hard-enforced, not just written guidance)

Enforced by `.claude/settings.json` + `.claude/hooks/git-safety-guard.mjs`
(a PreToolUse hook on every `git *` command) — these are blocked outright,
not just discouraged in this file:

- `git commit`, full stop — the user commits their own work, always. Not
  "ask first," not "commit and let the user review after" — never run it,
  even if asked to. Surface what's ready to commit and let the user run
  the command themselves.
- Force push, `git reset --hard`, `git clean -f`, force branch delete
  (`-D`).
- `git commit --no-verify` / `--no-gpg-sign` (skipping hooks or signing —
  moot now that `git commit` itself is fully blocked, kept here as
  documentation of intent).