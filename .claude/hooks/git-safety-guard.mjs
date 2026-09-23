#!/usr/bin/env node
// PreToolUse hook for Bash(git *) commands. See CLAUDE.md "Never do".
// Reads the tool-call JSON from stdin; exit 2 + stderr message blocks the
// command, exit 0 allows it.

import { readFileSync } from "node:fs";

function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseArgs(command) {
  // Good enough for guardrail purposes: split on whitespace, respecting
  // simple quoting. This is a safety net, not a shell parser.
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(command))) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

function findGitInvocations(command) {
  // A Bash tool call can chain multiple commands with && / ; / |.
  // Check each segment that looks like a git invocation.
  return command
    .split(/&&|;|\|/)
    .map((segment) => segment.trim())
    .filter((segment) => /(^|[\s/])git(\s|$)/.test(segment));
}

function checkForceOperations(args) {
  const sub = args[1];

  if (sub === "push" && (args.includes("--force") || args.includes("-f") || args.includes("--force-with-lease"))) {
    return "Blocked: force push is disabled. If this is truly necessary, ask the user to run it manually.";
  }
  if (sub === "reset" && args.includes("--hard")) {
    return "Blocked: `git reset --hard` is disabled — it discards uncommitted work. Ask the user before doing anything destructive.";
  }
  if (sub === "clean" && args.some((a) => a.startsWith("-") && a !== "-n" && a !== "--dry-run" && /f/.test(a))) {
    return "Blocked: `git clean -f` is disabled — it permanently deletes untracked files. Ask the user first.";
  }
  if (sub === "branch" && (args.includes("-D") || (args.includes("--delete") && args.includes("--force")))) {
    return "Blocked: force branch delete is disabled. Ask the user first.";
  }
  if (sub === "commit") {
    return "Blocked: `git commit` is disabled in this repo — the user commits their own work. Never run it, even if asked; tell the user what's ready to commit and let them run it themselves.";
  }
  return null;
}

// Note: this hook no longer checks profile provenance (a "sources" array
// on a committed content/profiles/*.json file) — that was the original
// copied-template data model. The real architecture stores profiles as
// Politician rows in Postgres with a NOT NULL source_item FK, enforced by
// the schema itself (see SPEC.md "Aggregator output schema"), not by a
// git hook inspecting committed files. There's no file-based artifact
// left for a hook to meaningfully check.

const raw = readStdin();
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0); // nothing to check
}

const command = payload?.tool_input?.command;
if (typeof command !== "string") process.exit(0);

for (const segment of findGitInvocations(command)) {
  const args = parseArgs(segment);
  const reason = checkForceOperations(args);
  if (reason) block(reason);
}

process.exit(0);
