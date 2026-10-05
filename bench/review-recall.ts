/**
 * Recall of the Sys1 core review rules on the whole-task trial's staged diffs.
 *
 * `rebuild` recreates the recorded tasks from their commits and seed. `run`
 * calls `sys1 review checkpoint` directly, with no agent, under one condition
 * from docs/REVIEW-RECALL-PLAN-2026-09.md and appends one record per task.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { plant, qualifies, snapshot, type ReviewTask } from "./claude-code-review-tasks.ts";

import { assertRunOutput, assertSettledAttempts, checkpointArgs, enableDecision, liveDecisionConfig, parseCheckpoint, redactHostedSecrets, type CheckpointResult, type DecisionConfig } from "./decision-provider.ts";
const RULE: Record<string, string> = { "empty-catch": "core-new-empty-catch", "removed-assertion": "core-removed-test-assertions" };
type Condition = "A" | "B" | "C";

function hasCommit(repo: string, c: string) {
  return spawnSync("git", ["-C", repo, "cat-file", "-e", `${c}^{commit}`]).status === 0;
}

export function rebuild(recorded: ReviewTask[], families: Record<string, string[]>, outDir: string, seed: string) {
  const kept: ReviewTask[] = [];
  for (const t of recorded) {
    const repo = families[t.cluster.split(":")[0]!]?.find((r) => hasCommit(r, t.commit));
    if (!repo) { console.log(`exclude ${t.id}: commit not found`); continue; }
    const staged = qualifies(repo, t.commit);
    const dir = join(outDir, "snapshots", t.id);
    if (!staged) { console.log(`exclude ${t.id}: no longer qualifies`); continue; }
    snapshot(repo, t.commit, dir);
    const path = t.kind === "clean" ? undefined : plant(dir, t.kind, staged, seed) ?? undefined;
    if (t.expected.answer === "VIOLATION" && path !== t.expected.path) {
      console.log(`exclude ${t.id}: planted ${path} not ${t.expected.path}`);
      continue;
    }
    kept.push({ ...t, repo: dir });
  }
  writeFileSync(join(outDir, "tasks.json"), JSON.stringify(kept, null, 2));
  console.log(`${kept.length} of ${recorded.length} tasks rebuilt`);
}

export function checkpoint(task: ReviewTask, cond: Condition, home: string, homeTemplate: string, config: DecisionConfig) {
  rmSync(home, { recursive: true, force: true });
  cpSync(homeTemplate, home, { recursive: true });
  enableDecision("sys1", [], home, config);
  const [max, timeout] = cond === "A" ? ["20", "30000"] : ["200", "120000"];
  const args = checkpointArgs(config, Number(max), Number(timeout), cond === "C" ? RULE[task.kind]! : undefined, cond === "C" ? task.expected.path! : undefined);
  const started = Date.now();
  const r = spawnSync("sys1", args, { cwd: task.repo, encoding: "utf8", env: { ...config.env, SYS1_HOME: home }, maxBuffer: 64 * 1024 * 1024, timeout: Number(timeout) + 30_000 });
  const elapsed_ms = Date.now() - started;
  let out: CheckpointResult;
  try {
    if (r.error || r.signal || r.status === null) throw new Error();
    out = parseCheckpoint(redactHostedSecrets(r.stdout, config.env));
  } catch { return { error: `checkpoint failed (exit ${r.status})`, elapsed_ms }; }
  const findings = (out.findings ?? []).map((f: any) => ({ rule: f.rule_id ?? f.rule, path: f.path, line: f.line, confidence: f.confidence ?? f.probability }));
  const targets = (out.audit?.targets ?? []).map((x: any) => x.path);
  const want = task.expected.path;
  return {
    status: out.status,
    requests: out.requests,
    usage: out.audit?.usage,
    units: out.audit?.units,
    evaluated_units: out.audit?.evaluated_units,
    planted_targeted: want ? targets.includes(want) : undefined,
    findings,
    hit: want ? findings.some((f: any) => f.rule === RULE[task.kind] && f.path === want) : undefined,
    false_positive: findings.some((f: any) => !want || f.path !== want),
    elapsed_ms,
  };
}

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "rebuild") {
    const [reportPath, familiesArg, outDir, seed] = rest;
    const recorded: ReviewTask[] = JSON.parse(readFileSync(reportPath!, "utf8")).tasks;
    const families = Object.fromEntries(familiesArg!.split(";").map((f) => { const [n, r] = f.split("="); return [n!, r!.split(",")]; }));
    mkdirSync(join(outDir!, "snapshots"), { recursive: true });
    rebuild(recorded, families, outDir!, seed!);
  } else if (mode === "run") {
    const [tasksPath, cond, label, outPath, homeTemplate] = rest as [string, Condition, string, string, string];
    const config = liveDecisionConfig();
    assertRunOutput(outPath);
    if (!["A", "B", "C"].includes(cond)) throw new Error("Condition must be A, B, or C");
    const tasks: ReviewTask[] = JSON.parse(readFileSync(tasksPath, "utf8"));
    const ledger: Record<string, unknown> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
    assertSettledAttempts(ledger);
    if (Object.values(ledger).some((record: any) => record.route !== config.route)) throw new Error("Use a new output path for a different decision route");
    for (const t of tasks) {
      if (cond === "C" && t.kind === "clean") continue;
      const key = `${label}:${t.id}`;
      if (ledger[key]) continue;
      ledger[key] = { condition: cond, id: t.id, kind: t.kind, route: config.route, state: "attempting" };
      writeFileSync(outPath, JSON.stringify(ledger, null, 2));
      const rec = checkpoint(t, cond, join(tasksPath, "..", "home-run"), homeTemplate, config);
      ledger[key] = { condition: cond, id: t.id, kind: t.kind, route: config.route, ...rec };
      writeFileSync(outPath, JSON.stringify(ledger, null, 2));
      if ("error" in rec) throw new Error("Checkpoint outcome is uncertain; reconcile the recorded attempt before continuing");
      console.log(`${key} ${rec.status} hit=${rec.hit} fp=${rec.false_positive} findings=${rec.findings.length} ${Math.round(rec.elapsed_ms / 1000)}s`);
    }
  } else {
    throw new Error("usage: bun bench/review-recall.ts rebuild REPORT.json FAMILIES OUT_DIR SEED | run TASKS.json A|B|C LABEL OUT.json SYS1_HOME_TEMPLATE");
  }
}
