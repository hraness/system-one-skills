/**
 * Recall of Sys1's `core-removed-test-assertions` rule on realistic diffs.
 * Plan: docs/ASSERTION-RECALL-PLAN-2026-09.md.
 *
 *   bun bench/assertion-recall.ts generate REPOS_ROOT "SET=repo[,repo];..." OUT_DIR SEED [PER_KIND]
 *   bun bench/assertion-recall.ts run REPOS_ROOT CASES_JSON OUT_JSON SYS1_CLI KEY_FILE
 *
 * Cases record only commit ids, paths and line numbers; code is rebuilt from the
 * local repos at run time.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type CaseKind = "violation" | "near-miss" | "clean";
export type AssertionCase = {
  id: string;
  set: string;
  /** Repo directory name under the REPOS_ROOT given at run time. */
  repo: string;
  commit: string;
  path: string;
  kind: CaseKind;
  /** 1-based line in the commit's version of `path` removed by the plant. */
  removed_line?: number;
  callback_line?: number;
};

export const RULE = "core-removed-test-assertions";

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

const rank = (seed: string, key: string) => createHash("sha256").update(`${seed}:${key}`).digest("hex");
export const isTestPath = (p: string) =>
  /\.(ts|tsx|mts|cts)$/.test(p) && !p.endsWith(".d.ts") &&
  (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p));

const OPEN = /^\s*(test|it)(\.(only|skip|concurrent|todo))?\(\s*["'`].*,\s*(async\s+)?(\(\s*\)|\w+|\([^()]*\))\s*=>\s*\{\s*$/;
const OTHER_CHECK = /\bthrow\b|\bassert|\bfail\(|\bt\.\w+\(|\b(check|verify|ensure|must)\w*\(|\bexpect\w+\(/i;
const EXPECT_STATEMENT = /^\s*(await\s+)?expect\(.*\)\s*\.(not\.|resolves\.|rejects\.)*to\w*\(.*\)\s*;?\s*$/;

function balanced(line: string): boolean {
  let depth = 0;
  for (const ch of line) {
    depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export type Callback = { start: number; end: number; body: string[]; expects: number[] };

/** Test callbacks (0-based open/close line) that satisfy the plan's qualification rules. */
export function qualifyingCallbacks(text: string): Callback[] {
  const lines = text.split("\n");
  const out: Callback[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN.test(lines[i]!)) continue;
    const indent = lines[i]!.match(/^\s*/)![0];
    let end = -1;
    for (let j = i + 1; j < lines.length && j <= i + 27; j++) {
      if (lines[j]!.startsWith(`${indent}})`) && /^\s*\}\)\s*;?\s*$/.test(lines[j]!)) { end = j; break; }
    }
    if (end < 0) continue;
    const body = lines.slice(i + 1, end);
    if (body.some((l) => /[{(\[]\s*$/.test(l) || /^\s*[}\]).]/.test(l))) continue;
    if (body.some((l) => OTHER_CHECK.test(l))) continue;
    const expects: number[] = [];
    let ok = true;
    body.forEach((l, k) => {
      if (!/\bexpect\b/.test(l)) return;
      if (EXPECT_STATEMENT.test(l) && balanced(l) && (l.match(/\bexpect\(/g) ?? []).length === 1) expects.push(i + 1 + k);
      else ok = false;
    });
    if (ok && expects.length) out.push({ start: i, end, body, expects });
  }
  return out;
}

export function removeLine(text: string, zeroBased: number): string {
  const lines = text.split("\n");
  lines.splice(zeroBased, 1);
  return lines.join("\n");
}

function fileAt(repo: string, rev: string, path: string): string | null {
  const r = spawnSync("git", ["show", `${rev}:${path}`], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function generate(root: string, setsArg: string, outDir: string, seed: string, perKind: number) {
  const cases: AssertionCase[] = [];
  const usedCallbacks = new Set<string>();
  for (const setSpec of setsArg.split(";")) {
    const [set, reposArg] = setSpec.split("=");
    const candidates = reposArg!.split(",").map((name) => join(root, name)).flatMap((repo) =>
      git(repo, "log", "--since=365.days", "--no-merges", "--format=%H").trim().split("\n").filter(Boolean).map((commit) => ({ repo, commit })));
    candidates.sort((a, b) => rank(seed, a.commit).localeCompare(rank(seed, b.commit)));
    const counts: Record<CaseKind, number> = { violation: 0, "near-miss": 0, clean: 0 };
    const order: CaseKind[] = ["violation", "near-miss", "clean"];
    let turn = 0;
    for (const { repo, commit } of candidates) {
      if (order.every((k) => counts[k] >= perKind)) break;
      const parents = git(repo, "rev-list", "--parents", "-n1", commit).trim().split(" ");
      if (parents.length !== 2) continue;
      const modified = git(repo, "diff", "--name-status", "--no-renames", `${commit}^`, commit).trim().split("\n")
        .map((r) => r.split("\t")).filter(([s, p]) => s === "M" && p && isTestPath(p)).map(([, p]) => p!);
      if (!modified.length) continue;
      let kind = order[turn % 3]!;
      for (let k = 0; k < 3 && counts[kind] >= perKind; k++) kind = order[(turn + k + 1) % 3]!;
      if (counts[kind] >= perKind) continue;
      const made = pick(repo, commit, modified.sort((a, b) => rank(seed, a).localeCompare(rank(seed, b))), kind, usedCallbacks);
      if (!made) continue;
      counts[kind]++;
      turn++;
      cases.push({ id: `${basename(repo)}-${commit.slice(0, 8)}-${kind}`, set: set!, repo: basename(repo), commit, kind, ...made });
    }
    console.log(set, JSON.stringify(counts));
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "cases.json"), JSON.stringify(cases, null, 2) + "\n");
}

function pick(repo: string, commit: string, paths: string[], kind: CaseKind, used: Set<string>):
  Pick<AssertionCase, "path" | "removed_line" | "callback_line"> | null {
  for (const path of paths) {
    const after = fileAt(repo, commit, path);
    const before = fileAt(repo, `${commit}^`, path);
    if (after === null || before === null) continue;
    if (kind === "clean") {
      const removed = git(repo, "diff", "-U0", `${commit}^`, commit, "--", path).split("\n")
        .filter((l) => l.startsWith("-") && !l.startsWith("---"));
      if (removed.some((l) => /expect\(|assert|throw/.test(l))) continue;
      return { path };
    }
    for (const cb of qualifyingCallbacks(after)) {
      const block = after.split("\n").slice(cb.start, cb.end + 1).join("\n");
      if (!before.includes(block)) continue;
      const key = createHash("sha256").update(block).digest("hex");
      if (used.has(key)) continue;
      if (kind === "violation") {
        if (cb.expects.length !== 1) continue;
        const at = cb.expects[0]!;
        if (at - cb.start > 14 || cb.end - at > 14) continue;
        used.add(key);
        return { path, removed_line: at + 1, callback_line: cb.start + 1 };
      }
      if (cb.expects.length < 2) continue;
      used.add(key);
      return { path, removed_line: cb.expects[0]! + 1, callback_line: cb.start + 1 };
    }
  }
  return null;
}

/** Materializes a case in `clone` (a clone of its repo): parent checked out, commit staged, plant applied. */
export function materialize(clone: string, c: Pick<AssertionCase, "commit" | "path" | "removed_line">) {
  git(clone, "reset", "-q", "--hard");
  git(clone, "clean", "-qfdx");
  git(clone, "checkout", "-q", "--detach", `${c.commit}^`);
  git(clone, "restore", "--source", c.commit, "--staged", "--worktree", ":/");
  if (c.removed_line) {
    const file = join(clone, c.path);
    writeFileSync(file, removeLine(readFileSync(file, "utf8"), c.removed_line - 1));
    git(clone, "add", "--", c.path);
  }
}

function run(root: string, casesPath: string, outPath: string, cli: string, keyFile: string) {
  const cases: AssertionCase[] = JSON.parse(readFileSync(casesPath, "utf8"));
  const ledger: Record<string, unknown> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")).results ?? {} : {};
  const scratch = mkdtempSync(join(tmpdir(), "assertion-recall-"));
  const key = readFileSync(keyFile, "utf8").trim();
  const clones = new Map<string, string>();
  const sys1Commit = git(join(cli, "..", ".."), "rev-parse", "HEAD").trim();
  try {
    for (const c of cases) {
      if (ledger[c.id]) continue;
      let clone = clones.get(c.repo);
      if (!clone) {
        clone = join(scratch, c.repo);
        git(scratch, "clone", "-q", "--shared", "--no-checkout", join(root, c.repo), clone);
        clones.set(c.repo, clone);
      }
      materialize(clone, c);
      const home = join(scratch, "home");
      rmSync(home, { recursive: true, force: true });
      mkdirSync(home);
      writeFileSync(join(home, "config.json"), JSON.stringify({ hosted: { enabled: true } }));
      const started = Date.now();
      const r = spawnSync("bun", [cli, "review", "checkpoint", "--staged", "--json", "--model", "typesafe/jev-1.13.0",
        "--max-requests", "200", "--timeout-ms", "120000", "--rule", RULE, "--", c.path], {
        cwd: clone, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, SYS1_HOME: home, TYPESAFE_API_KEY: key, HRANESS_AUDIENCE: "quiet" },
      });
      const elapsed_ms = Date.now() - started;
      let out: any;
      try { out = JSON.parse(r.stdout); } catch {
        ledger[c.id] = { kind: c.kind, set: c.set, error: `${r.status}: ${(r.stderr || r.stdout).slice(0, 300)}`, elapsed_ms };
        continue;
      }
      const findings = (out.findings ?? []).map((f: any) => ({ rule: f.rule_id ?? f.rule, path: f.path, line: f.line }));
      ledger[c.id] = {
        kind: c.kind, set: c.set, status: out.status, requests: out.requests,
        units: out.audit?.units, evaluated_units: out.audit?.evaluated_units,
        findings, flagged: findings.some((f: any) => f.rule === RULE && f.path === c.path), elapsed_ms,
      };
      writeFileSync(outPath, JSON.stringify({ sys1: sys1Commit, route: "typesafe/jev-1.13.0", results: ledger }, null, 2) + "\n");
      console.log(c.id, (ledger[c.id] as any).status, (ledger[c.id] as any).flagged);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  writeFileSync(outPath, JSON.stringify({ sys1: sys1Commit, route: "typesafe/jev-1.13.0", results: ledger }, null, 2) + "\n");
}

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "generate") generate(rest[0]!, rest[1]!, rest[2]!, rest[3]!, Number(rest[4] ?? "30"));
  else if (mode === "run") run(rest[0]!, rest[1]!, rest[2]!, rest[3]!, rest[4]!);
  else throw new Error("usage: generate REPOS_ROOT SETS OUT_DIR SEED [PER_KIND] | run REPOS_ROOT CASES_JSON OUT_JSON SYS1_CLI KEY_FILE");
}
