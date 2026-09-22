#!/usr/bin/env node
// PreToolUse hook for Bash(git *) commands. See CLAUDE.md "Never do".
// Reads the tool-call JSON from stdin; exit 2 + stderr message blocks the
// command, exit 0 allows it.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

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
  if (sub === "commit" && (args.includes("--no-verify") || args.includes("--no-gpg-sign") || args.includes("-n"))) {
    return "Blocked: `git commit --no-verify`/`--no-gpg-sign` is disabled — hooks and signing must not be skipped.";
  }
  return null;
}

function getStagedProfileFiles() {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^content\/profiles\/.*\.json$/.test(line));
  } catch {
    return [];
  }
}

function checkProfileSources(args) {
  if (args[1] !== "commit") return null;

  const files = getStagedProfileFiles();
  for (const file of files) {
    let content;
    try {
      content = execSync(`git show :${JSON.stringify(file).slice(1, -1)}`, { encoding: "utf8" });
    } catch {
      continue; // file not readable from the index (e.g. deleted) — nothing to validate
    }
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      return `Blocked: ${file} is staged but is not valid JSON.`;
    }
    if (!Array.isArray(data.sources) || data.sources.length === 0) {
      return `Blocked: ${file} has an empty or missing "sources" array. Every profile must cite its sources.`;
    }
  }
  return null;
}

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
  const reason = checkForceOperations(args) ?? checkProfileSources(args);
  if (reason) block(reason);
}

process.exit(0);
