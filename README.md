# Political Watchtower

A low-friction way for voters to see who represents them, what those
representatives have actually done (votes, sponsored bills, news
coverage), and how they compare to their peers.

**Status: early-stage / pre-code.** This repo currently holds the project
spec and repo guardrails; no application code exists yet. See
[SPEC.md](SPEC.md) for the full staged build plan and current progress.

## Goals

- **Primary-source first.** Voting records, bill sponsorships, and
  committee membership come from official government data and publish
  automatically, with a source link on every item.
- **Narrative content is clearly labeled.** Bios, news summaries, and any
  AI-generated summaries always link back to their original source/author
  and are marked as narrative, not primary-source fact.
- **Nonpartisan.** This is an accountability tool, not an advocacy
  platform — the same treatment applies regardless of party.
- **Built to be forked.** The pilot jurisdiction is the Utah State
  Legislature, but the codebase is designed so someone in another state
  (or country) can point it at their own legislature without a rewrite.

## How it's structured

The core app is jurisdiction-agnostic. Each jurisdiction (Utah's
legislature, US Congress, and eventually others) implements a common
"jurisdiction adapter" interface — fetch legislators, fetch votes, fetch
bills, fetch news — so the app itself never hardcodes assumptions about
any one state's data source. Comparison and visualization features (radar
charts, voting-alignment scores, issue scorecards, leaderboards) are
similarly built as independent, swappable modules rather than one fixed
page, so views can be added or removed without touching the others.

Full architecture decisions and the stage-by-stage build plan live in
[SPEC.md](SPEC.md).

## Contributing / adding your own jurisdiction

Not yet ready for external contributions — the jurisdiction adapter
interface hasn't been built yet (see SPEC.md Stage 1). Once it exists and
has been proven against two real, differently-shaped data sources (Utah
and US Congress), this section will cover what it takes to add a new
state.

## Repo guardrails

See [CLAUDE.md](CLAUDE.md) for the working rules this repo enforces
(what needs sign-off, what's hard-blocked at the git level, etc).

## License

[AGPL-3.0](LICENSE.txt) — chosen so that hosted forks of this project stay
open source.
