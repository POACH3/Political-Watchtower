## Verification of Work

Before starting any multi-step build, always include a verification plan as part of the plan itself — don't wait for me to ask for one.

## Project Structure

Pre-code stage — no app scaffold yet. What exists today:

- `SPEC.md` — the staged build plan, architecture decisions, and open
  questions to confirm before starting each stage.
- `README.md` — project overview and current status.
- `CLAUDE.md` — this file.
- `.claude/` — settings, permissions, and `hooks/git-safety-guard.mjs`
  (the PreToolUse hook backing the "Never do" rules below).

This section gets filled in with the real app layout once Stage 0
scaffolding (Next.js app, Docker Compose, CI) lands — see SPEC.md.

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

### Never do (hard-enforced, not just written guidance)

Enforced by `.claude/settings.json` + `.claude/hooks/git-safety-guard.mjs`
(a PreToolUse hook on every `git *` command) — these are blocked outright,
not just discouraged in this file:

- Force push, `git reset --hard`, `git clean -f`, force branch delete
  (`-D`).
- `git commit --no-verify` / `--no-gpg-sign` (skipping hooks or signing).
- Committing a politician profile (`content/profiles/*.json`) with an
  empty or missing `sources` array. This project's editorial policy
  (SPEC.md) auto-publishes structured/primary-source data without a human
  review gate, which makes source attribution on every profile
  non-negotiable — there's no other check standing between a bad scrape
  and a real person's public page.
