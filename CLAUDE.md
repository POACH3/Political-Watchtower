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
  `settings.local.json` (gitignored personal overrides — untracked; it
  was once committed by mistake as an empty file),
  `hooks/git-safety-guard.mjs` (the PreToolUse hook backing the "Never
  do" rules below; run on every Bash call, and it understands git global
  options, `+refspec` pushes, command chaining, `$(...)`, `sh -c`, and
  heredocs/single quotes as data), `hooks/git-safety-guard.check.mjs`
  (its test matrix — `node --test
  .claude/hooks/git-safety-guard.check.mjs`; named `.check.mjs`, not
  `.test.mjs`, so Vitest doesn't pick it up), and empty
  `skills/`/`rules/`/`output-styles/` directories (see below).
- `Dockerfile`, `docker-compose.yml` — local dev: the Next.js app +
  Postgres, plus a one-shot `migrate` service the app waits on so a clean
  `docker compose up` gets a migrated database. `.env` is optional for
  compose (`required: false`). Stage 3 adds the worker service once
  there's a real collector to run.
- `.github/workflows/ci.yml` — lint, typecheck, `db:migrate`, `db:check`
  (snapshot chain consistent), a drift check (`db:generate` must produce
  no new/changed migration file), test, and `next build` on every
  push/PR, with its own Postgres service container. No deploy step.
- `drizzle.config.ts` — Drizzle Kit config (schema location, migrations
  output, DB credentials from `DATABASE_URL`).
- `src/app/` — Next.js App Router. Still just the Stage 0 placeholder
  homepage — no real routes/pages yet (that's Stage 5+).
- `src/db/schema/` — the full Postgres schema, both Stage 1 (government
  records: jurisdictions, people, legislation, votes, committees &
  meetings, collected-items) and Stage 2 (narrative/oversight: processor
  runs, news, claims, promises, review) — 35 tables with an `updated_at`
  column plus `review_actions`/`suppression_rules`; one file per `SPEC.md`
  subsection, re-exported from `index.ts`. Stage 1 and Stage 2 stay in
  *separate migrations* even though they're both applied now, per
  "Staging notes" in `SPEC.md`. `_shared.ts` holds the id/timestamp column
  helpers and `suppressionConsistentCheck`. Entities `SPEC.md` designs but
  schedules for a later stage (`PipelineEvent`, `Affiliation`,
  `CollectorJob`, `User`, `ProfileSummary`, `CommunityFlag`) do **not**
  exist yet — see each stage's Build list. Constraint tests live next to
  the schema (`constraints.test.ts`, `stage2-constraints.test.ts`,
  `integrity-constraints.test.ts` — the last is the regression suite for
  the gaps a schema review found).
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
    source rows and a `NewsItem` can't commit with zero source rows
    (hand-written — a plain FK/CHECK can't express "must have a row of a
    specific kind in another table").
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
  separator and rename both files. The wipe deletes
  `meta/_journal.json`, which drizzle-kit needs in order to start — recreate
  it as `{"version":"7","dialect":"postgresql","entries":[]}` first. A
  from-scratch generate produces no "created or renamed?" prompts (there's
  no prior snapshot to compare to); generated output is plain (no section
  comments) and gets a short hand-written header. Hand-written migrations (or
  hand-written content merged into a generated file) need a matching
  entry added to `migrations/meta/_journal.json` — Drizzle Kit won't
  discover a raw `.sql` file, or hand-appended content in a file it did
  generate, on its own. Only 2 snapshot files exist (`0000`, `0001`)
  even though there are 3 migrations — a snapshot only needs to exist at
  the migration index representing the latest point-in-time
  Drizzle-representable schema state; hand-written SQL (triggers,
  exclusion constraints) isn't representable in a snapshot at all, so
  `0002` needs none. Its journal `when` must be greater than `0001`'s
  (regeneration stamps new timestamps) or the migrator skips it on an
  already-migrated database; and every new table with an `updated_at`
  column needs a trigger line added to `0002` (a test fails if one is
  missing). Always verify a restructuring like this actually
  left the snapshot chain intact: wipe the Docker volume, run
  `npm run db:migrate` clean, then run `npm run db:generate` again with
  no further schema changes — it should print "No schema changes,
  nothing to migrate" rather than silently drifting or erroring.
  `drizzle-kit generate` itself needs a real TTY when it detects an
  ambiguous drop-one-column-add-another-in-the-same-table change (it
  prompts "created or renamed?" — only when layering onto an existing
  snapshot) — run it via `expect` (auto-answering
  "create column" at each prompt) rather than piping stdin, which just
  errors with "Interactive prompts require a TTY terminal."
- `src/db/index.ts` — the Drizzle client. Only `src/lib/services/*` should
  import this — see decision #4: presenters/collectors/processors call
  named service functions, never the database directly. The client is
  cached on `globalThis` outside production so hot reload doesn't leak
  connection pools.
- `src/db/migrate.mts` — standalone migration runner (`npm run
  db:migrate`). Loads `.env` itself (`process.loadEnvFile()`, which never
  overrides variables already set) since nothing else does for a plain
  script invocation — don't remove that and assume `DATABASE_URL` will
  just be there. The actual work is `runMigrations()` in
  `src/db/run-migrations.ts`, which the test harness reuses.
- `src/lib/pipeline/types.ts` — the four pipeline-layer interfaces
  (`Collector`, `Aggregator`, `Processor`, `Presenter`) from "Four-layer
  modular pipeline." Only `Collector` has a concrete shape in use so far
  (`JurisdictionAdapter`); the others are typed contracts waiting on
  Stage 9/10/6 to implement them for real. Also defines the
  `SourceSnapshot`/`Collected<T>` envelope: a collector returns parsed
  records paired with the verbatim response they came from, and the
  aggregator writes one `CollectedItem` per snapshot (that's how every
  record gets a `source_item` — collectors never touch the DB).
- `src/lib/adapters/jurisdiction-adapter.ts` — the `JurisdictionAdapter`
  interface + `mockJurisdictionAdapter` (fake data, no network calls).
  Covers sessions, chambers, districts, legislators, committees,
  meetings, bills, votes (and optionally elections); `collect()` yields
  them as tagged records in FK-dependency order. Stage 3 replaces the mock
  with a real pilot-state implementation; the interface itself shouldn't
  need to change to accommodate that.
- `src/lib/normalize.ts` — `hashPayload()` (sha-256 hex) and
  `normalizeUrl()`; the shared helpers behind every exact-dedup key.
- `src/lib/services/` — the shared service layer. `collected-items.ts`
  (`createCollectedItem` — computes `content_hash` itself from
  `rawPayload` (callers don't supply one), normalizes `source_url`, and
  dedups on the `(content_hash, source_url)` key via ON CONFLICT DO
  NOTHING + re-select, so an unchanged re-poll writes nothing; `rawPayload`
  is a `string`, the original fetched text verbatim, never a JS object to
  be re-serialized; `findCollectedItemByHash`), `jurisdictions.ts`
  (single-statement upserts), `politicians.ts` (advisory-lock-serialized
  upsert by external id) so far — enough to prove the
  pattern and support Stage 1/2's own tests, not a complete service layer
  for every entity yet (no `bills`/`votes`/`terms`/`claims`/`promises`/
  `news-items` service functions — those get built as later stages
  actually need to write to them, not speculatively now).
- `src/lib/test-utils.ts` — `pgErrorMessage()`: Drizzle wraps the real
  Postgres error in a `DrizzleQueryError` whose top-level `.message` is
  just `"Failed query: ..."` — the actual constraint-violation text is on
  `.cause`. Use this helper in any test asserting on a DB error message
  rather than matching `.message` directly. Also `makeSourceItem()`, the
  one shared "give me a valid `source_item`" test helper.
- `public/` — static assets (default Next.js scaffold assets; unused ones
  haven't been cleaned up yet).
- `package.json` / `package-lock.json` — Next.js 16, React 19, Tailwind 4,
  Drizzle ORM + Drizzle Kit, Vitest. Scripts: `dev`, `build`, `start`,
  `lint`, `typecheck`, `test`, `db:generate`, `db:check`, `db:migrate`.
- `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`,
  `eslint.config.mjs`, `vitest.config.mts` — standard framework config.
  `vitest.config.mts` also loads `.env`, sets up the `@/*` path alias
  (Vitest doesn't pick up `tsconfig.json`'s paths automatically the way
  Next.js's own bundler does), and points tests at a separate
  `<DATABASE_URL's name>_test` database (override with
  `TEST_DATABASE_URL`; the name must end in `_test`, since
  `vitest.global-setup.mts` drops and recreates it — then migrates it —
  before every run). Tests never touch the dev database.
  `vitest.test-db.ts` resolves that URL.

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
  Goal → Cross-cutting architecture decisions (numbered 1-9, referenced
  elsewhere as "decision #N") → Data collector architecture → Aggregator
  output schema (the full entity/table definitions) → Claim-preserving
  content model (the defamation-resistant design) → Provenance chain &
  processor accountability (`ProcessorRun`/`PipelineEvent` — formalizes
  "processing version" and "history of corrections" for every processor
  and every field, not just the ones that happened to need them first)
  → Validation & acceptance criteria → Testing strategy → Staging notes.
- **The staged build plan**: Stage 0 through Stage 18, each with a
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
  first. Hard-enforced via `permissions.ask` (`Bash(git push*)`).
  (`git commit` is not in this tier — see "Never do" below: the user runs
  every commit themselves, full stop.)
- Substantive edits to SPEC.md's guardrails or stage definitions (not just
  doc formatting).
- Major dependency version bumps.
- Enabling Stage 8-10 features (crawler, claim extraction, AI content) in
  any publicly-reachable deployment without Stage 11's documented legal
  sign-off already in hand — SPEC.md states this as a hard gate multiple
  times; treat it as one here too, not just prose elsewhere.

### Never do (hard-enforced, not just written guidance)

Enforced by `.claude/settings.json` (a `permissions.deny` rule for `git
commit`) + `.claude/hooks/git-safety-guard.mjs` (a PreToolUse hook on every
Bash command; it finds the real git subcommand past global options like
`git -C dir commit`, and sees through chaining, `$(...)` and `sh -c`) —
these are blocked outright, not just discouraged in this file. It can't see
shell aliases or git aliases defined in a config file:

- `git commit`, full stop — the user commits their own work, always. Not
  "ask first," not "commit and let the user review after" — never run it,
  even if asked to. Surface what's ready to commit and let the user run
  the command themselves.
- Force push, `git reset --hard`, `git clean -f`, force branch delete
  (`-D`).
- `git commit --no-verify` / `--no-gpg-sign` (skipping hooks or signing —
  moot now that `git commit` itself is fully blocked, kept here as
  documentation of intent).