/**
 * Claude Code adapter for paired whole-task trials of system-one-verify.
 *
 * Each task runs twice in fresh copy-on-write clones of a frozen snapshot: the
 * native arm (no skill) and the skill arm (skill installed as a project skill).
 * Arm order is randomized from a seeded hash. Usage and wall time come from the
 * Claude Code result record, which covers every turn and subagent through the
 * final answer. Raw evidence stays under the private output directory.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Task = {
  id: string;
  cluster: string;
  repo: string; // absolute path of the frozen snapshot directory
  command: string;
  expected: { exit_code: number; must_mention: string[] };
  prompt: string;
};

type ArmName = "baseline" | "skill";
type ArmRecord = {
  arm: ArmName;
  session: string;
  elapsed_ms: number;
  cost_usd: number;
  is_error: boolean;
  num_turns: number;
  usage: Record<string, number>;
  model_usage: Record<string, Record<string, number>>;
  used_skill: boolean;
  result: string;
};

const MODEL = "claude-sonnet-5-5";
const TOOLS = ["Bash", "Read", "Grep", "Glob", "Skill"];
const DENIED = ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent"];

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

export function orderFor(seed: string, id: string): ArmName[] {
  const bit = createHash("sha256").update(`${seed}:${id}`).digest()[0]! & 1;
  return bit ? ["skill", "baseline"] : ["baseline", "skill"];
}

function prepareClone(task: Task, arm: ArmName, workRoot: string): string {
  const dir = join(workRoot, `${task.id}-${arm}`);
  rmSync(dir, { recursive: true, force: true });
  const cp = sh("cp", ["-c", "-R", task.repo, dir]);
  if (cp.status !== 0) throw new Error(`clone failed for ${task.id}: ${cp.stderr}`);
  rmSync(join(dir, ".claude", "skills", "system-one-verify"), { recursive: true, force: true });
  if (arm === "skill") {
    const r = sh("system-one-skills", ["install-skills", "--target", ".claude/skills"], { cwd: dir });
    if (r.status !== 0) throw new Error(`skill install failed for ${task.id}: ${r.stderr}`);
  }
  return dir;
}

function runArm(task: Task, arm: ArmName, workRoot: string, evidenceDir: string, budgetUsd: number): ArmRecord {
  const dir = prepareClone(task, arm, workRoot);
  writeFileSync(join(workRoot, "empty-mcp.json"), '{"mcpServers":{}}');
  const args = [
    "-p", task.prompt,
    "--model", MODEL,
    "--output-format", "stream-json", "--verbose",
    "--setting-sources", "project,local",
    "--strict-mcp-config", "--mcp-config", join(workRoot, "empty-mcp.json"),
    "--no-session-persistence",
    "--allowedTools", ...TOOLS,
    "--disallowedTools", ...DENIED,
    "--max-budget-usd", String(budgetUsd),
  ];
  const started = Date.now();
  const r = sh("claude", args, { cwd: dir, timeout: 20 * 60_000 });
  const wall = Date.now() - started;
  writeFileSync(join(evidenceDir, `${task.id}-${arm}.jsonl`), r.stdout ?? "");
  const events = (r.stdout ?? "").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const result = events.findLast((e) => e.type === "result");
  if (!result) throw new Error(`no result record for ${task.id}/${arm}: ${(r.stderr ?? "").slice(0, 400)}`);
  const usedSkill = events.some((e) => e.type === "assistant" && JSON.stringify(e.message?.content ?? "").includes("system-one-skills check"));
  rmSync(dir, { recursive: true, force: true });
  return {
    arm,
    session: result.session_id,
    elapsed_ms: wall,
    cost_usd: result.total_cost_usd,
    is_error: Boolean(result.is_error),
    num_turns: result.num_turns,
    usage: {
      input_tokens: result.usage.input_tokens,
      cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
      cache_read_input_tokens: result.usage.cache_read_input_tokens,
      output_tokens: result.usage.output_tokens,
    },
    model_usage: result.modelUsage,
    used_skill: usedSkill,
    result: String(result.result ?? ""),
  };
}

if (import.meta.main) {
  const [tasksPath, outDir, seed, budgetArg, maxTotalArg] = process.argv.slice(2);
  if (!tasksPath || !outDir || !seed) {
    throw new Error("usage: bun bench/claude-code-run.ts TASKS.json OUT_DIR SEED [PER_ARM_USD] [TOTAL_USD]");
  }
  const perArm = Number(budgetArg ?? "0.6");
  const maxTotal = Number(maxTotalArg ?? "20");
  const tasks: Task[] = JSON.parse(readFileSync(tasksPath, "utf8"));
  const evidenceDir = join(outDir, "evidence");
  const workRoot = join(outDir, "work");
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(workRoot, { recursive: true });
  const ledgerPath = join(outDir, "runs.json");
  const runs: Record<string, ArmRecord[]> = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : {};
  let spent = Object.values(runs).flat().reduce((sum, r) => sum + r.cost_usd, 0);
  for (const task of tasks) {
    if (runs[task.id]?.length === 2) continue;
    if (spent + 2 * perArm > maxTotal) {
      console.log(`stop: budget ${spent.toFixed(2)} of ${maxTotal} used`);
      break;
    }
    const records: ArmRecord[] = [];
    for (const arm of orderFor(seed, task.id)) {
      const rec = runArm(task, arm, workRoot, evidenceDir, perArm);
      records.push(rec);
      spent += rec.cost_usd;
    }
    runs[task.id] = records;
    writeFileSync(ledgerPath, JSON.stringify(runs, null, 2));
    const arms = records.map((r) => `${r.arm}:${Math.round(r.elapsed_ms / 1000)}s/$${r.cost_usd.toFixed(3)}`).join(" ");
    console.log(`${task.id} ${arms} skill_used=${records.find((r) => r.arm === "skill")?.used_skill} spent=$${spent.toFixed(2)}`);
  }
}
