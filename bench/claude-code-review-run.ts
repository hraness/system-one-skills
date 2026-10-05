/**
 * Claude Code adapter for paired whole-task trials of the Sys1 review checkpoint.
 *
 * Same protocol as claude-code-run.ts: fresh copy-on-write clones, seeded arm
 * order, usage and wall time from the Claude Code result record. The Sys1 arm
 * adds the sys1-review project skill, one CLAUDE.md adoption line, `sys1` on
 * PATH, a fresh SYS1_HOME with Clef enabled, and environment credentials. The
 * baseline arm gets none of these, and no key.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orderFor } from "./claude-code-run.ts";
import type { ReviewTask } from "./claude-code-review-tasks.ts";
import { adoptionLine, assertRunOutput, enableDecision, liveDecisionConfig, redactHostedSecrets, withoutHostedCredentials, type DecisionConfig } from "./decision-provider.ts";

type ArmName = "baseline" | "skill";
const MODEL = "claude-sonnet-5-5";
const TOOLS = ["Bash", "Read", "Grep", "Glob", "Skill"];
const DENIED = ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent"];
export const ADOPTION_LINE = adoptionLine({ provider: "clef", model: "clef", route: "cloudflare/clef", env: {}, enableArgs: [] });

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

export function armEnv(arm: ArmName, workRoot: string, sys1Bin: string, homeTemplate: string, config: DecisionConfig): NodeJS.ProcessEnv {
  const env = withoutHostedCredentials(process.env);
  if (arm === "baseline") return env;
  const home = join(workRoot, "sys1-home");
  rmSync(home, { recursive: true, force: true });
  cpSync(homeTemplate, home, { recursive: true });
  const selected = { ...config.env, PATH: `${sys1Bin}:${env.PATH}`, SYS1_HOME: home };
  enableDecision("sys1", [], home, { ...config, env: selected });
  return selected;
}

function runArm(task: ReviewTask, arm: ArmName, workRoot: string, evidenceDir: string, budgetUsd: number, sys1Bin: string, homeTemplate: string, config: DecisionConfig) {
  const dir = join(workRoot, `${task.id}-${arm}`);
  rmSync(dir, { recursive: true, force: true });
  const cp = sh("cp", ["-c", "-R", task.repo, dir]);
  if (cp.status !== 0) throw new Error(`clone failed for ${task.id}: ${cp.stderr}`);
  rmSync(join(dir, ".claude", "skills", "sys1-review"), { recursive: true, force: true });
  const env = armEnv(arm, workRoot, sys1Bin, homeTemplate, config);
  if (arm === "skill") {
    const r = sh("sys1", ["review", "setup", "claude-code"], { cwd: dir, env, timeout: 30_000 });
    if (r.status !== 0) throw new Error(`skill install failed for ${task.id} (exit ${r.status})`);
    appendFileSync(join(dir, "CLAUDE.md"), adoptionLine(config));
    // Setup files and CLAUDE.md are untracked or unstaged, so the staged diff is unchanged.
  }
  writeFileSync(join(workRoot, "empty-mcp.json"), '{"mcpServers":{}}');
  const prompt = arm === "skill" && process.env.REVIEW_DIRECTED === "1"
    ? `${task.prompt}\nUse this repository's Sys1 review checkpoint for this check.`
    : task.prompt;
  const args = [
    "-p", prompt,
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
  const r = sh("claude", args, { cwd: dir, env, timeout: 20 * 60_000 });
  const wall = Date.now() - started;
  const stdout = redactHostedSecrets(r.stdout ?? "", config.env);
  writeFileSync(join(evidenceDir, `${task.id}-${arm}.jsonl`), stdout);
  const events = stdout.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const result = events.findLast((e) => e.type === "result");
  if (r.error || r.signal || r.status === null || !result) throw new Error(`uncertain result for ${task.id}/${arm} (exit ${r.status}); reconcile the recorded attempt before rerunning`);
  const usedSkill = events.some((e) => e.type === "assistant" && /sys1 review checkpoint(?![^"]*--dry-run)/.test(JSON.stringify(e.message?.content ?? "")));
  rmSync(dir, { recursive: true, force: true });
  return {
    arm,
    decision_route: arm === "skill" ? config.route : null,
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
  const [tasksPath, outDir, seed, budgetArg, maxTotalArg, sys1Bin, homeTemplate] = process.argv.slice(2);
  if (!tasksPath || !outDir || !seed || !sys1Bin || !homeTemplate) {
    throw new Error("usage: bun bench/claude-code-review-run.ts TASKS.json OUT_DIR SEED PER_ARM_USD TOTAL_USD SYS1_BIN_DIR SYS1_HOME_TEMPLATE");
  }
  const config = liveDecisionConfig();
  assertRunOutput(outDir);
  const perArm = Number(budgetArg ?? "0.6");
  const maxTotal = Number(maxTotalArg ?? "15");
  if (![perArm, maxTotal].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Budgets must be finite positive dollar amounts");
  const tasks: ReviewTask[] = JSON.parse(readFileSync(tasksPath, "utf8"));
  const evidenceDir = join(outDir, "evidence");
  const workRoot = join(outDir, "work");
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(workRoot, { recursive: true });
  const ledgerPath = join(outDir, "runs.json");
  const runs: Record<string, ReturnType<typeof runArm>[]> = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : {};
  if (Object.values(runs).some((records) => records.length !== 2 || records.some((record) => record.is_error))) throw new Error("An incomplete or failed task attempt is recorded; reconcile it before rerunning");
  if (Object.values(runs).flat().some((r) => r.arm === "skill" && r.decision_route !== config.route)) throw new Error("Use a new output directory for a different decision route");
  let spent = Object.values(runs).flat().reduce((sum, r) => sum + r.cost_usd, 0);
  for (const task of tasks) {
    if (runs[task.id]?.length === 2) continue;
    if (spent + 2 * perArm > maxTotal) {
      console.log(`stop: budget ${spent.toFixed(2)} of ${maxTotal} used`);
      break;
    }
    const records: ReturnType<typeof runArm>[] = [];
    runs[task.id] = records;
    writeFileSync(ledgerPath, JSON.stringify(runs, null, 2));
    for (const arm of orderFor(seed, task.id)) {
      const rec = runArm(task, arm, workRoot, evidenceDir, perArm, sys1Bin, homeTemplate, config);
      records.push(rec);
      writeFileSync(ledgerPath, JSON.stringify(runs, null, 2));
      if (rec.is_error && /session limit|rate limit|429/i.test(rec.result)) {
        console.log(`stop: usage limit at ${task.id}/${arm}: ${rec.result.slice(0, 120)}`);
        process.exit(3);
      }
      if (rec.is_error) throw new Error(`Task ${task.id}/${arm} failed; reconcile the recorded attempt before continuing`);
      spent += rec.cost_usd;
    }
    runs[task.id] = records;
    writeFileSync(ledgerPath, JSON.stringify(runs, null, 2));
    const arms = records.map((r) => `${r.arm}:${Math.round(r.elapsed_ms / 1000)}s/$${r.cost_usd.toFixed(3)}`).join(" ");
    console.log(`${task.id} ${arms} sys1_used=${records.find((r) => r.arm === "skill")?.used_skill} spent=$${spent.toFixed(2)}`);
  }
}
