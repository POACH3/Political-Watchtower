// Run with: node --test .claude/hooks/git-safety-guard.check.mjs
// Named *.check.mjs (not *.test.mjs) on purpose so Vitest's default
// include globs don't pick it up.

import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("./git-safety-guard.mjs", import.meta.url));

function run(command) {
  const result = spawnSync("node", [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  return result.status;
}

const BLOCKED = [
  "git commit -m x",
  "git -C . commit -m x",
  "git --no-pager commit",
  "git -c user.name=x commit",
  "/usr/bin/git commit",
  "env GIT_AUTHOR_NAME=x git commit",
  "sudo git commit",
  "a && git commit",
  "a || git commit",
  "a; git commit",
  "a\ngit commit",
  "echo hi | git commit",
  "echo $(git commit -m x)",
  "echo `git commit -m x`",
  'bash -c "git commit -m x"',
  "sh -c 'git commit'",
  'eval "git commit"',
  "git -c alias.ci=commit ci",
  "git push --force",
  "git push -f",
  "git push -fu origin main",
  "git push origin +main",
  "git push origin HEAD:+main",
  "git push --force-with-lease",
  "git push --force-with-lease=main:abc",
  "git push --mirror",
  "git reset --hard",
  "git reset --hard HEAD~1",
  "git -C sub reset --hard",
  "git clean -f",
  "git clean -fd",
  "git clean --force",
  "git branch -D old",
  "git branch -fD old",
  "git branch --delete --force old",
  "git branch -df old",
  // a heredoc doesn't hide what comes after it, and an unquoted one still
  // expands substitutions
  "cat <<'EOF'\nnotes\nEOF\ngit commit -m x",
  "cat <<EOF\n$(git commit -m x)\nEOF",
  'cat <<EOF\n`git commit -m x`\nEOF',
  "cat <<'EOF' && git commit -m x\nnotes\nEOF",
];

const ALLOWED = [
  "git status",
  "git log --grep=commit",
  "git log --oneline -5",
  "git diff",
  "git add -A",
  "git push",
  "git push origin main",
  "git push -u origin main",
  "git commit-graph write",
  "git clean -n",
  "git clean -nd",
  "git clean --dry-run",
  "git branch -d merged",
  "git branch",
  "git reset --soft HEAD~1",
  "git -C sub status",
  "git -c color.ui=always log",
  "echo 'git commit'",
  'echo "run git commit yourself"',
  "npm test && git status",
  "ls | grep git",
  // heredoc bodies and single-quoted text are data, not commands
  "cat <<'EOF'\nrun `git commit` yourself\nEOF",
  "cat <<'EOF' > notes.md\ngit commit -m x\n$(git commit)\nEOF",
  "python3 - <<'EOF'\ns = '`git commit` is blocked'\nEOF",
  "cat <<-EOF\n\tplain text with git commit in it\n\tEOF",
  "echo '$(git commit)'",
  "echo '`git commit`'",
];

for (const command of BLOCKED) {
  test(`blocks: ${JSON.stringify(command)}`, () => assert.equal(run(command), 2));
}
for (const command of ALLOWED) {
  test(`allows: ${JSON.stringify(command)}`, () => assert.equal(run(command), 0));
}

test("ignores non-JSON stdin and non-Bash payloads", () => {
  const junk = spawnSync("node", [hook], { input: "not json", encoding: "utf8" });
  assert.equal(junk.status, 0);
  const noCommand = spawnSync("node", [hook], { input: JSON.stringify({ tool_input: {} }), encoding: "utf8" });
  assert.equal(noCommand.status, 0);
});
