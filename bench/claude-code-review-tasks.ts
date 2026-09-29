/**
 * Builds staged-change review tasks for the Sys1 review checkpoint trial.
 *
 * Each task is a real commit staged on top of its parent in a shared clone. A
 * lexical screen rejects commits that already add an empty catch or remove an
 * assertion. Some tasks then get one planted violation: an existing catch body
 * emptied in place, or the only expect line removed from a test callback. The
 * answer key is frozen here; graders never see which arm produced an answer.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ReviewKind = "clean" | "empty-catch" | "removed-assertion";
export type ReviewTask = {
  id: string;
  cluster: string;
  repo: string;
  kind: ReviewKind;
  commit: string;
  expected: { answer: "CLEAN" | "VIOLATION"; path?: string };
  prompt: string;
};

export const REVIEW_PROMPT = [
  "Review the staged changes in this repository before I commit them.",
  "Check for exactly two problems, and nothing else:",
  "1. A JavaScript or TypeScript catch block that this change introduces empty, or empties by removing its last executable statement.",
  "2. A test callback that loses its last behavioral assertion (for example its only expect or assert) in this change.",
  "Do not edit anything. End your reply with exactly one line:",
  "`ANSWER: CLEAN` if neither problem is present, or `ANSWER: VIOLATION <repo-relative path>` naming the file with the problem.",
].join("\n");

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

const rank = (seed: string, key: string) => createHash("sha256").update(`${seed}:${key}`).digest("hex");
const isTs = (p: string) => /\.(ts|tsx|mts|cts)$/.test(p) && !p.endsWith(".d.ts");
const isTest = (p: string) => /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p);

export function qualifies(repo: string, commit: string): string[] | null {
  const parents = git(repo, "rev-list", "--parents", "-n1", commit).trim().split(" ");
  if (parents.length !== 2) return null;
  let files = 0;
  let lines = 0;
  const changed: string[] = [];
  for (const row of git(repo, "diff", "--numstat", `${commit}^`, commit).trim().split("\n").filter(Boolean)) {
    const [add, del, path] = row.split("\t");
    if (!path || add === "-" || !isTs(path)) continue;
    files++;
    lines += Number(add) + Number(del);
    changed.push(path);
  }
  if (files < 2 || files > 20 || lines < 150 || lines > 2500) return null;
  const diff = git(repo, "diff", "-U0", `${commit}^`, commit, "--", ...changed);
  if (/^\+.*catch\s*(\([^)]*\))?\s*\{\s*\}/m.test(diff)) return null;
  if (/^-\s*(expect\(|assert)/m.test(diff)) return null;
  return changed;
}

/** Empties the first 1-4 line catch body with no nested braces. */
export function emptyCatch(text: string): string | null {
  const m = /(catch\s*(?:\([^)]*\))?\s*\{\n)((?:[^{}\n]*\n){1,4}?)([ \t]*\})/.exec(text);
  if (!m || !m[2]!.trim()) return null;
  return text.slice(0, m.index) + m[1] + m[3] + text.slice(m.index + m[0].length);
}

/** Removes the only expect line from the first test callback that has exactly one. */
export function removeOnlyAssertion(text: string): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(it|test)(\.\w+)?\(.*=>\s*\{\s*$/.test(lines[i]!)) continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]!) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
      if (depth === 0) { end = j; break; }
    }
    if (end < 0) continue;
    const body = lines.slice(i + 1, end);
    const hits = body.map((l, k) => [l, k] as const).filter(([l]) => /\bexpect\(/.test(l));
    if (hits.length !== 1 || body.some((l) => /\bassert/.test(l))) continue;
    const [line, k] = hits[0]!;
    if (!/^\s*expect\(.*\);?\s*$/.test(line)) continue;
    lines.splice(i + 1 + k, 1);
    return lines.join("\n");
  }
  return null;
}

export function snapshot(repo: string, commit: string, dir: string) {
  rmSync(dir, { recursive: true, force: true });
  git(repo, "clone", "-q", "--shared", "--no-checkout", repo, dir);
  git(dir, "checkout", "-q", "--detach", `${commit}^`);
  git(dir, "read-tree", "-u", "-m", "HEAD", commit);
}

export function plant(dir: string, kind: ReviewKind, staged: string[], seed: string): string | null {
  const byRank = (xs: string[]) => [...xs].sort((a, b) => rank(seed, a).localeCompare(rank(seed, b)));
  if (kind === "empty-catch") {
    for (const p of byRank(staged.filter((x) => !isTest(x)))) {
      let text: string;
      try { text = readFileSync(join(dir, p), "utf8"); } catch { continue; }
      const next = emptyCatch(text);
      if (next) { writeFileSync(join(dir, p), next); git(dir, "add", "--", p); return p; }
    }
    return null;
  }
  const stagedTests = staged.filter(isTest);
  const all = git(dir, "ls-files").split("\n").filter((p) => isTs(p) && isTest(p));
  for (const p of [...byRank(stagedTests), ...byRank(all.filter((x) => !stagedTests.includes(x)))]) {
    let text: string;
    try { text = readFileSync(join(dir, p), "utf8"); } catch { continue; }
    const next = removeOnlyAssertion(text);
    if (next) { writeFileSync(join(dir, p), next); git(dir, "add", "--", p); return p; }
  }
  return null;
}

if (import.meta.main) {
  const [reposArg, outDir, seed, perFamilyArg] = process.argv.slice(2);
  if (!reposArg || !outDir || !seed) throw new Error("usage: bun bench/claude-code-review-tasks.ts FAMILY=repo[,repo]... OUT_DIR SEED [PER_FAMILY]");
  const perFamily = Number(perFamilyArg ?? "8");
  const mix: ReviewKind[] = ["clean", "empty-catch", "clean", "removed-assertion", "clean", "empty-catch", "clean", "removed-assertion"];
  mkdirSync(join(outDir, "snapshots"), { recursive: true });
  const tasks: ReviewTask[] = [];
  for (const family of reposArg.split(";")) {
    const [name, repos] = family.split("=");
    const candidates = repos!.split(",").flatMap((repo) =>
      git(repo, "log", "--since=90.days", "--no-merges", "--format=%H").trim().split("\n").filter(Boolean).map((c) => ({ repo, c })));
    candidates.sort((a, b) => rank(seed, a.c).localeCompare(rank(seed, b.c)));
    let made = 0;
    for (const { repo, c } of candidates) {
      if (made >= perFamily) break;
      const staged = qualifies(repo, c);
      if (!staged) continue;
      const kind = mix[made % mix.length]!;
      const id = `${repo.split("/").pop()}-${c.slice(0, 8)}-${kind}`;
      const dir = join(outDir, "snapshots", id);
      snapshot(repo, c, dir);
      let path: string | undefined;
      if (kind !== "clean") {
        const planted = plant(dir, kind, staged, seed);
        if (!planted) { rmSync(dir, { recursive: true, force: true }); console.log(`skip ${id}: nothing to plant`); continue; }
        path = planted;
      }
      tasks.push({
        id, cluster: `${name}:${c}`, repo: dir, kind, commit: c,
        expected: kind === "clean" ? { answer: "CLEAN" } : { answer: "VIOLATION", path },
        prompt: REVIEW_PROMPT,
      });
      made++;
      console.log(`keep ${id} ${staged.length} files${path ? ` planted=${path}` : ""}`);
    }
  }
  writeFileSync(join(outDir, "tasks.json"), JSON.stringify(tasks, null, 2));
  console.log(`${tasks.length} tasks`);
}
