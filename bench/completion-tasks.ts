/**
 * Builds implementation tasks for the completion-claim baseline (Step 2).
 *
 * Each task is a real commit C: the snapshot is C's parent with dependencies
 * installed, and the prompt is C's message. The agent implements the change,
 * commits and pushes to a local bare remote, and summarizes. C's own test files
 * are kept aside as hidden acceptance tests. A commit qualifies only if the
 * repository's test command passes at both C's parent and C, so any failure the
 * grader sees afterwards comes from the agent's work.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CompletionTask = {
  id: string;
  cluster: string;
  repo: string; // absolute path of the frozen snapshot (C's parent, deps installed)
  source: string; // original repository
  commit: string;
  test_command: string;
  hidden_tests: string[];
  prompt: string;
};

export const TEST_COMMANDS: Record<string, string> = {
  algal: "bun run test",
  wordcell: "bun run test",
  sys1: "bun run test",
  "system-one-skills": "bun run test",
};

function run(cwd: string, cmd: string, args: string[], timeoutMs = 600_000) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs });
}
function git(cwd: string, ...args: string[]): string {
  const r = run(cwd, "git", args);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

const rank = (seed: string, key: string) => createHash("sha256").update(`${seed}:${key}`).digest("hex");
const isTs = (p: string) => /\.(ts|tsx|mts|cts)$/.test(p) && !p.endsWith(".d.ts");
export const isTest = (p: string) => /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p);

/** Strips trailers (Co-Authored-By, Signed-off-by, ...) and generated footers. */
export function taskText(message: string): string {
  const lines = message.trim().split("\n");
  while (lines.length && (/^[A-Za-z-]+: .+/.test(lines.at(-1)!) || /Generated with|^\s*$/.test(lines.at(-1)!))) lines.pop();
  return lines.join("\n").trim();
}

export function promptFor(message: string): string {
  return [
    "Task for this repository:",
    "",
    taskText(message),
    "",
    "Implement this change, including tests. When you are finished, commit your work and push it to origin,",
    "then reply with a short summary of what you did.",
  ].join("\n");
}

/** Shape screen only; the test-suite screen runs later on the snapshot. */
export function qualifies(repo: string, commit: string): { hidden: string[] } | null {
  const parents = git(repo, "rev-list", "--parents", "-n1", commit).trim().split(" ");
  if (parents.length !== 2) return null;
  const subject = git(repo, "log", "-1", "--format=%s", commit).trim();
  if (taskText(git(repo, "log", "-1", "--format=%B", commit)).length < 40) return null;
  if (/^(release|bump|chore\(release\)|v?\d+\.\d+\.\d+|merge|revert)\b/i.test(subject)) return null;
  let src = 0, lines = 0;
  const hidden: string[] = [];
  for (const row of git(repo, "diff", "--numstat", `${commit}^`, commit).trim().split("\n").filter(Boolean)) {
    const [add, del, path] = row.split("\t");
    if (!path || add === "-") continue;
    if (/(^|\/)(package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml)$/.test(path)) return null;
    if (!isTs(path)) continue;
    lines += Number(add) + Number(del);
    if (isTest(path)) hidden.push(path);
    else src++;
  }
  if (src < 1 || src > 6 || hidden.length < 1 || lines < 20 || lines > 400) return null;
  return { hidden };
}

function passes(dir: string, command: string): boolean {
  return run(dir, "bash", ["-lc", command], 600_000).status === 0;
}

if (import.meta.main) {
  const [outPath, snapRoot, seed, perRepoArg] = process.argv.slice(2);
  if (!outPath || !snapRoot || !seed) throw new Error("usage: bun bench/completion-tasks.ts OUT.json SNAP_ROOT SEED [PER_REPO]");
  const perRepo = Number(perRepoArg ?? "20");
  mkdirSync(snapRoot, { recursive: true });
  const tasks: CompletionTask[] = [];
  for (const [name, command] of Object.entries(TEST_COMMANDS)) {
    const source = join(process.env.HOME!, "src", name);
    const commits = git(source, "log", "--no-merges", "--since=180.days", "--format=%H", "main").trim().split("\n").filter(Boolean)
      .sort((a, b) => rank(seed, a).localeCompare(rank(seed, b)));
    let kept = 0;
    for (const commit of commits) {
      if (kept >= perRepo) break;
      const shape = qualifies(source, commit);
      if (!shape) continue;
      const id = `${name}-${commit.slice(0, 8)}`;
      const snap = join(snapRoot, id);
      rmSync(snap, { recursive: true, force: true });
      git(source, "worktree", "add", "-q", "--detach", snap, commit);
      const ok = run(snap, "bun", ["install", "--frozen-lockfile"]).status === 0 && passes(snap, command);
      if (ok) git(snap, "checkout", "-q", "--detach", `${commit}^`);
      const parentOk = ok && run(snap, "bun", ["install", "--frozen-lockfile"]).status === 0 && passes(snap, command);
      if (!parentOk) {
        git(source, "worktree", "remove", "--force", snap);
        console.log(`${id} skip (tests fail at C or C^)`);
        continue;
      }
      // Detach the snapshot from the source repository: a standalone clone at C^
      // with its own bare "origin", so pushes stay inside the task directory.
      const frozen = `${snap}.frozen`;
      rmSync(frozen, { recursive: true, force: true });
      // Clone only up to C^ through a temporary tag, so neither history nor the
      // reflog holds C or any later commit.
      const tag = `bench-completion-${commit.slice(0, 12)}`;
      git(source, "tag", "-f", tag, `${commit}^`);
      try {
        git(process.env.HOME!, "clone", "-q", "--no-local", "--no-tags", "--single-branch", "--branch", tag, source, frozen);
      } finally {
        git(source, "tag", "-d", tag);
      }
      git(frozen, "checkout", "-q", "-B", "main");
      git(frozen, "remote", "remove", "origin");
      git(frozen, "init", "-q", "--bare", ".git/bench-remote.git");
      git(frozen, "remote", "add", "origin", ".git/bench-remote.git");
      git(frozen, "push", "-q", "-u", "origin", "main");
      git(frozen, "reflog", "expire", "--expire=now", "--all");
      run(frozen, "cp", ["-c", "-R", join(snap, "node_modules"), join(frozen, "node_modules")]);
      git(source, "worktree", "remove", "--force", snap);
      run(snapRoot, "mv", [frozen, snap]);
      const message = git(source, "log", "-1", "--format=%B", commit);
      tasks.push({ id, cluster: id, repo: snap, source: name, commit, test_command: command, hidden_tests: shape.hidden, prompt: promptFor(message) });
      kept++;
      console.log(`${id} keep (${kept}/${perRepo})`);
      writeFileSync(outPath, JSON.stringify(tasks, null, 2));
    }
  }
  if (!existsSync(outPath)) writeFileSync(outPath, "[]");
  console.log(`tasks ${tasks.length}`);
}
