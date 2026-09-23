@CLAUDE.local.md
@AGENTS.md

## Verification of Work

Before starting any multi-step build, always include a verification plan as part of the plan itself — don't wait for me to ask for one.

## Project Structure

Always check here before assuming.

**Here's how this repo is structured:** Stage 0 and Stage 1 are done
(government-records schema + pipeline interfaces); Stage 2 (narrative/
oversight schema — Claim, Promise, NewsItem, ReviewAction) is next. What
actually exists today:

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
- `src/db/schema/` — the actual Postgres schema, Stage 1 scope only
  (government records: jurisdictions, people, legislation, votes,
  collected-items). One file per `SPEC.md` subsection, re-exported from
  `index.ts`. Stage 2 adds a matching set for Claim/Promise/NewsItem/
  ReviewAction — kept in *separate* files/migrations from Stage 1's,
  deliberately, per "Staging notes" in `SPEC.md`.
- `src/db/migrations/` — Drizzle-generated SQL, plus one hand-written
  migration (`0001_term_no_overlap.sql`) for the `Term` exclusion
  constraint Drizzle has no native syntax for. Hand-written migrations
  need a matching entry added to `migrations/meta/_journal.json` — Drizzle
  Kit won't discover a raw `.sql` file on its own.
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
  Stage 2/9/10/6 to implement them for real.
- `src/lib/adapters/jurisdiction-adapter.ts` — the `JurisdictionAdapter`
  interface + `mockJurisdictionAdapter` (fake data, no network calls).
  Stage 3 replaces the mock with a real pilot-state implementation; the
  interface itself shouldn't need to change to accommodate that.
- `src/lib/services/` — the shared service layer. `collected-items.ts`,
  `jurisdictions.ts`, `politicians.ts` so far — enough to prove the
  pattern and support Stage 1's own tests, not a complete service layer
  for every Stage 1 entity yet.
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

Stage 2 is next: the narrative/oversight schema (Claim, Promise,
NewsItem, ReviewAction, SuppressionRule, and their join tables) — see
`SPEC.md` for the full list. Everything past that (real pilot-state data,
the admin GUI, presenters, processors) doesn't exist in code yet.

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
- `git commit` and `git push` — no commit gets made and nothing leaves the
  machine without explicit confirmation first. `git push` is hard-enforced
  via `permissions.ask`; `git commit` is written guidance only for now —
  it isn't in `.claude/settings.json`'s `ask` list yet (add
  `"Bash(git commit*)"` there if you want it hard-enforced the same way;
  that file can't be self-edited by Claude, so it needs your own change).
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

- Force push, `git reset --hard`, `git clean -f`, force branch delete
  (`-D`).
- `git commit --no-verify` / `--no-gpg-sign` (skipping hooks or signing).