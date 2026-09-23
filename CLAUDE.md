@CLAUDE.local.md
@AGENTS.md

## Verification of Work

Before starting any multi-step build, always include a verification plan as part of the plan itself — don't wait for me to ask for one.

## Project Structure

Always check here before assuming.

**Here's how this repo is structured:** pre-code stage — no app scaffold
yet (Stage 0's Next.js/Docker Compose/CI work is still open). What
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
- `.env.example` — documents every environment variable the app will
  need (DB connection, admin credential, LLM/government-API keys), each
  tagged with the `SPEC.md` stage that introduces it. Copy to `.env`
  (gitignored) for real local values — never commit real secrets.
- `LICENSE.txt` — AGPL-3.0.
- `.gitignore` — also covers `CLAUDE.local.md`, `.env`, and
  `.claude/settings.local.json`.
- `.claude/` — `settings.json` (permissions, hooks config),
  `settings.local.json` (gitignored personal overrides),
  `hooks/git-safety-guard.mjs` (the PreToolUse hook backing the "Never
  do" rules below), and empty `skills/`/`rules/`/`output-styles/`
  directories (see below).
- `src/app/` — Next.js App Router. Just the Stage 0 placeholder homepage
  so far (`page.tsx` + a trivial `page.test.ts`) — no real routes yet.
- `public/` — static assets (default Next.js scaffold assets; unused ones
  haven't been cleaned up yet).
- `package.json` / `package-lock.json` — Next.js 16, React 19, Tailwind 4,
  Vitest for tests. Scripts: `dev`, `build`, `start`, `lint`, `typecheck`,
  `test`.
- `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`,
  `eslint.config.mjs`, `vitest.config.ts` — standard framework config,
  nothing project-specific yet.

Still missing from Stage 0: Docker Compose + `Dockerfile` for local dev,
and the GitHub Actions CI workflow. Everything past Stage 0 (the actual
data model, pipeline, admin GUI, etc.) doesn't exist in code yet — that's
all still `SPEC.md`, not `src/`.

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