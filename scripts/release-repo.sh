#!/usr/bin/env bash
# Prints "owner/name", the GitHub repository Liner Code's releases come from: package.json's
# "repository" if it names one, or else the origin of Liner Code's own repository (not of a repo
# it merely sits inside, like a home folder kept in git). Nothing when there's neither.
cd "$(dirname "$0")/.."
node -e '
const pkg = require("./package.json");
const r = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
const name = (s) => (/^(?:github:)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(s.trim()) ?? /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(s.trim()))?.[1] ?? "";
let repo = name(r);
if (!repo) {
  const git = (...a) => require("node:child_process").execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (require("node:fs").realpathSync(git("rev-parse", "--show-toplevel")) === require("node:fs").realpathSync(process.cwd())) repo = name(git("remote", "get-url", "origin"));
  } catch {}
}
process.stdout.write(repo);
'
