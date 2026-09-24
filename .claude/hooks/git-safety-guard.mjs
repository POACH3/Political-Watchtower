#!/usr/bin/env node
// PreToolUse hook for Bash commands. See CLAUDE.md "Never do".
// Reads the tool-call JSON from stdin; exit 2 + stderr message blocks the
// command, exit 0 allows it.
//
// This is a safety net, not a shell parser: it understands quoting,
// command separators (&& || ; | & newline), $(...)/backtick substitution,
// `sh -c "..."`/`eval`, common wrappers (env/sudo/...), and git's global
// options (`git -C dir commit`), which is what the previous
// "subcommand = args[1]" version missed. It can't see shell aliases or
// git aliases defined in a config file.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

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

// --- Lexing -------------------------------------------------------------

// Separates heredoc bodies from the command text. A body is data, not
// commands — this repo's docs are full of backticked `git commit`, and a
// heredoc that writes them must not be mistaken for running one. The
// exception is an *unquoted* delimiter (<<EOF), whose body still expands
// $(...) and backticks, so those bodies are returned for substitution
// scanning only.
function splitHeredocs(command) {
  const lines = command.split("\n");
  const code = [];
  const expandingBodies = [];
  for (let i = 0; i < lines.length; i++) {
    code.push(lines[i]);
    const pending = [];
    for (const m of lines[i].matchAll(/(?<!<)<<(-?)\s*(['"]?)\\?([A-Za-z_][A-Za-z0-9_]*)\2/g)) {
      pending.push({ dash: m[1] === "-", quoted: m[2] !== "" || /<<-?\s*\\/.test(m[0]), delimiter: m[3] });
    }
    for (const doc of pending) {
      const body = [];
      i++;
      while (i < lines.length && (doc.dash ? lines[i].trim() : lines[i]) !== doc.delimiter) {
        body.push(lines[i]);
        i++;
      }
      if (!doc.quoted) expandingBodies.push(body.join("\n"));
    }
  }
  return { code: code.join("\n"), expandingBodies };
}

// Pulls out $(...) and `...` bodies (they execute even when nested inside
// double quotes, but not inside single quotes), returning them for
// separate analysis.
function extractSubstitutions(command) {
  const bodies = [];
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (c === "$" && command[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      while (j < command.length && depth > 0) {
        if (command[j] === "(") depth++;
        else if (command[j] === ")") depth--;
        j++;
      }
      bodies.push(command.slice(i + 2, depth === 0 ? j - 1 : j));
    } else if (command[i] === "`") {
      const end = command.indexOf("`", i + 1);
      if (end !== -1) {
        bodies.push(command.slice(i + 1, end));
        i = end;
      }
    }
  }
  return bodies;
}

// Splits into segments of tokens on unquoted separators, honouring
// single/double quotes and backslash escapes.
function lex(command) {
  const segments = [];
  let tokens = [];
  let current = "";
  let inToken = false;
  let quote = null;

  const endToken = () => {
    if (inToken) tokens.push(current);
    current = "";
    inToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < command.length) current += command[++i];
      else current += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inToken = true;
    } else if (c === "\\" && i + 1 < command.length) {
      current += command[++i];
      inToken = true;
    } else if (c === "&" || c === "|" || c === ";" || c === "\n" || c === "(" || c === ")") {
      endSegment();
    } else if (/\s/.test(c)) {
      endToken();
    } else {
      current += c;
      inToken = true;
    }
  }
  endSegment();
  return segments;
}

// --- Analysis -----------------------------------------------------------

const WRAPPERS = new Set(["env", "command", "sudo", "time", "nohup", "exec", "builtin", "nice", "xargs"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
// git global options that consume the following token when written
// without "=" (e.g. `-C dir`, `-c key=value`, `--git-dir path`).
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
  "--exec-path",
]);

const isShortCluster = (arg) => /^-[a-zA-Z]+$/.test(arg);
const clusterHas = (args, letter) => args.some((a) => isShortCluster(a) && a.includes(letter));

function checkGit(args) {
  // args: tokens after the `git` word.
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    const opt = args[i];
    if (opt === "-c" && /^alias\./.test(args[i + 1] ?? "")) {
      return "Blocked: defining a git alias inline (`-c alias.*`) could smuggle a blocked command past this guard.";
    }
    i += GIT_VALUE_OPTIONS.has(opt) ? 2 : 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) return null;

  if (sub === "commit") {
    return "Blocked: `git commit` is disabled in this repo — the user commits their own work. Never run it, even if asked; tell the user what's ready to commit and let them run it themselves.";
  }
  if (sub === "push") {
    const forced = rest.some(
      (a) =>
        a === "--force" ||
        a.startsWith("--force-with-lease") ||
        a === "--force-if-includes" ||
        a === "--mirror" ||
        (isShortCluster(a) && a.includes("f")) ||
        (!a.startsWith("-") && (a.startsWith("+") || a.includes(":+"))),
    );
    if (forced) {
      return "Blocked: force push is disabled (including `+refspec` and --force-with-lease). If this is truly necessary, ask the user to run it manually.";
    }
  }
  if (sub === "reset" && rest.includes("--hard")) {
    return "Blocked: `git reset --hard` is disabled — it discards uncommitted work. Ask the user before doing anything destructive.";
  }
  if (sub === "clean") {
    const force = rest.includes("--force") || clusterHas(rest, "f");
    const dryRun = rest.includes("--dry-run") || clusterHas(rest, "n");
    if (force && !dryRun) {
      return "Blocked: `git clean -f` is disabled — it permanently deletes untracked files. Ask the user first.";
    }
  }
  if (sub === "branch") {
    const forceDelete =
      clusterHas(rest, "D") ||
      ((rest.includes("--delete") || rest.includes("-d") || clusterHas(rest, "d")) &&
        (rest.includes("--force") || clusterHas(rest, "f")));
    if (forceDelete) return "Blocked: force branch delete is disabled. Ask the user first.";
  }
  return null;
}

function checkSegment(tokens, depth) {
  let i = 0;
  // Leading VAR=value assignments and wrapper commands (with their
  // options) before the real command word.
  for (;;) {
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    if (i < tokens.length && WRAPPERS.has(basename(tokens[i]))) {
      i++;
      while (i < tokens.length && (tokens[i].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))) i++;
      continue;
    }
    break;
  }
  const word = tokens[i];
  if (!word) return null;
  const name = basename(word);

  if (name === "git") return checkGit(tokens.slice(i + 1));

  // `bash -c "git commit"`, `eval "git commit"` — analyse the payload.
  if (depth < 5 && SHELLS.has(name)) {
    const c = tokens.findIndex((t, k) => k > i && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t));
    if (c !== -1 && tokens[c + 1] !== undefined) return checkCommand(tokens[c + 1], depth + 1);
  }
  if (depth < 5 && name === "eval") return checkCommand(tokens.slice(i + 1).join(" "), depth + 1);
  return null;
}

export function checkCommand(rawCommand, depth = 0) {
  const { code: command, expandingBodies } = splitHeredocs(rawCommand);
  const substitutions = [...extractSubstitutions(command), ...expandingBodies.flatMap(extractSubstitutions)];
  for (const body of substitutions) {
    const reason = depth < 5 ? checkCommand(body, depth + 1) : null;
    if (reason) return reason;
  }
  for (const tokens of lex(command)) {
    const reason = checkSegment(tokens, depth);
    if (reason) return reason;
  }
  return null;
}

// --- Entry point --------------------------------------------------------

// Note: this hook no longer checks profile provenance (a "sources" array
// on a committed content/profiles/*.json file) — that was the original
// copied-template data model. The real architecture stores profiles as
// Politician rows in Postgres with a NOT NULL source_item FK, enforced by
// the schema itself (see SPEC.md "Aggregator output schema"), not by a
// git hook inspecting committed files.

if (import.meta.url === `file://${process.argv[1]}`) {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    process.exit(0); // nothing to check
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== "string") process.exit(0);

  const reason = checkCommand(command);
  if (reason) block(reason);
  process.exit(0);
}
