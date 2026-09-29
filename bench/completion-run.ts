/**
 * Runs the completion-claim baseline (Step 2): Claude Code alone, no Sys1.
 *
 * Each task runs once per model in a fresh copy-on-write clone of its frozen
 * snapshot, with Claude Code's sandbox on, web tools denied, and GitHub CLI
 * credentials removed. The only remote is a bare repository inside the clone's
 * .git directory. After the agent stops, the runner records ground truth:
 * worktree state, whether commits reached the remote, the repository's test
 * command on the worktree as the agent left it, and the original commit's test
 * files (hidden acceptance tests) on that same worktree. Claims are extracted later, blind,
 * by completion-grade.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CompletionTask } from "./completion-tasks.ts";

export const MODELS = { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-4-5-20251001" } as const;
export type ModelKey = keyof typeof MODELS;

export type Truth = {
  dirty_paths: string[];
  unpushed_commits: number;
  local_commits: number;
  remote_commits: number;
  /** The repository's test command on the worktree exactly as the agent left it. */
  tests_as_left: { exit: number | null; ran: string; tail: string } | null;
  /** The original commit's test files copied onto that worktree. */
  hidden_as_left: { exit: number | null; ran: string; tail: string } | null;
};

export type RunRecord = {
  task: string;
  model: ModelKey;
  session: string;
  elapsed_ms: number;
  cost_usd: number;
  is_error: boolean;
  subtype: string;
  num_turns: number;
  usage: Record<string, number>;
  max_tool_result_bytes: number;
  final_message: string;
  truth: Truth;
};

export const SANDBOX_SETTINGS = {
  sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false },
  permissions: { allow: ["Bash"], deny: ["WebFetch", "WebSearch", `Read(/${process.env.HOME}/src/**)`, `Read(/${process.env.HOME}/.cache/sys1-bench/**)`] },
};

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts });
}
const gitOut = (cwd: string, ...args: string[]) => (sh("git", args, { cwd }).stdout ?? "").trim();
const tail = (s: string, n = 1500) => s.slice(-n);

function testAt(agentDir: string, task: CompletionTask, scratch: string, hidden: boolean) {
  const dir = join(scratch, hidden ? "hidden" : "suite");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  if (sh("cp", ["-c", "-R", agentDir, dir]).status !== 0) return null;
  if (!hidden) {
    // A failing suite is rerun once; it counts as failing only if both runs fail.
    let r = sh("bash", ["-lc", task.test_command], { cwd: dir, timeout: 600_000 });
    const reran = r.status !== 0;
    if (reran) r = sh("bash", ["-lc", task.test_command], { cwd: dir, timeout: 600_000 });
    rmSync(dir, { recursive: true, force: true });
    return { exit: r.status, ran: reran ? "rerun" : "", tail: tail((r.stdout ?? "") + (r.stderr ?? "")) };
  }
  const source = join(process.env.HOME!, "src", task.source);
  for (const path of task.hidden_tests) {
    const content = sh("git", ["show", `${task.commit}:${path}`], { cwd: source });
    if (content.status !== 0) continue; // deleted by the commit
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content.stdout);
  }
  const r = sh("bun", ["test", ...task.hidden_tests.map((p) => `./${p}`)], { cwd: dir, timeout: 600_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  rmSync(dir, { recursive: true, force: true });
  return { exit: r.status, ran: out.match(/Ran \d+ tests? across \d+ files?/)?.[0] ?? "", tail: tail(out) };
}

export function groundTruth(dir: string, task: CompletionTask, scratch: string): Truth {
  const base = gitOut(task.repo, "rev-parse", "HEAD");
  const remote = join(dir, ".git", "bench-remote.git");
  const remoteHead = gitOut(remote, "rev-parse", "main");
  return {
    dirty_paths: gitOut(dir, "status", "--porcelain").split("\n").filter(Boolean),
    unpushed_commits: Number(gitOut(dir, "rev-list", "--count", `${remoteHead}..HEAD`) || 0),
    local_commits: Number(gitOut(dir, "rev-list", "--count", `${base}..HEAD`) || 0),
    remote_commits: Number(gitOut(remote, "rev-list", "--count", `${base}..main`) || 0),
    tests_as_left: testAt(dir, task, scratch, false),
    hidden_as_left: testAt(dir, task, scratch, true),
  };
}

function runOne(task: CompletionTask, model: ModelKey, workRoot: string, evidenceDir: string, budgetUsd: number): RunRecord {
  const dir = join(workRoot, `${task.id}-${model}`);
  rmSync(dir, { recursive: true, force: true });
  if (sh("cp", ["-c", "-R", task.repo, dir]).status !== 0) throw new Error(`clone failed for ${task.id}`);
  const settings = join(workRoot, "settings.json");
  const mcp = join(workRoot, "empty-mcp.json");
  writeFileSync(settings, JSON.stringify(SANDBOX_SETTINGS));
  writeFileSync(mcp, '{"mcpServers":{}}');
  mkdirSync(join(workRoot, "gh-empty"), { recursive: true });
  const env = { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", GH_CONFIG_DIR: join(workRoot, "gh-empty"), TYPESAFE_API_KEY: "" };
  const args = [
    "-p", task.prompt,
    "--model", MODELS[model],
    "--output-format", "stream-json", "--verbose",
    "--setting-sources", "project,local",
    "--settings", settings,
    "--strict-mcp-config", "--mcp-config", mcp,
    "--no-session-persistence",
    "--permission-mode", "acceptEdits",
    "--max-budget-usd", String(budgetUsd),
  ];
  const started = Date.now();
  const r = sh("claude", args, { cwd: dir, env, timeout: 30 * 60_000 });
  const wall = Date.now() - started;
  writeFileSync(join(evidenceDir, `${task.id}-${model}.jsonl`), r.stdout ?? "");
  const events = (r.stdout ?? "").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const result = events.findLast((e) => e.type === "result");
  if (!result) throw new Error(`no result record for ${task.id}/${model}: ${(r.stderr ?? "").slice(0, 400)}`);
  const toolResults = events.filter((e) => e.type === "user").flatMap((e) => Array.isArray(e.message?.content) ? e.message.content : [])
    .filter((c: { type?: string }) => c.type === "tool_result").map((c: unknown) => Buffer.byteLength(JSON.stringify(c)));
  const lastText = events.filter((e) => e.type === "assistant").flatMap((e) => e.message?.content ?? [])
    .filter((c: { type?: string }) => c.type === "text").map((c: { text: string }) => c.text).at(-1) ?? "";
  const truth = groundTruth(dir, task, join(workRoot, "scratch"));
  rmSync(dir, { recursive: true, force: true });
  return {
    task: task.id,
    model,
    session: result.session_id,
    elapsed_ms: wall,
    cost_usd: result.total_cost_usd ?? 0,
    is_error: Boolean(result.is_error),
    subtype: String(result.subtype ?? ""),
    num_turns: result.num_turns,
    usage: {
      input_tokens: result.usage?.input_tokens ?? 0,
      cache_creation_input_tokens: result.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: result.usage?.cache_read_input_tokens ?? 0,
      output_tokens: result.usage?.output_tokens ?? 0,
    },
    max_tool_result_bytes: Math.max(0, ...toolResults),
    final_message: String(result.result || lastText),
    truth,
  };
}

if (import.meta.main) {
  const [tasksPath, outDir, modelsArg, capsArg, totalArg] = process.argv.slice(2);
  if (!tasksPath || !outDir) {
    throw new Error("usage: bun bench/completion-run.ts TASKS.json OUT_DIR [sonnet,haiku] [SONNET_USD,HAIKU_USD] [TOTAL_USD]");
  }
  const models = (modelsArg ?? "sonnet,haiku").split(",") as ModelKey[];
  const [sonnetCap, haikuCap] = (capsArg ?? "2,0.8").split(",").map(Number);
  const caps: Record<ModelKey, number> = { sonnet: sonnetCap!, haiku: haikuCap! };
  const maxTotal = Number(totalArg ?? "40");
  const tasks: CompletionTask[] = JSON.parse(readFileSync(tasksPath, "utf8"));
  const evidenceDir = join(outDir, "evidence");
  const workRoot = join(outDir, "work");
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(workRoot, { recursive: true });
  const ledgerPath = join(outDir, "runs.json");
  const runs: RunRecord[] = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : [];
  let spent = runs.reduce((sum, r) => sum + r.cost_usd, 0);
  outer: for (const task of tasks) {
    for (const model of models) {
      if (runs.some((r) => r.task === task.id && r.model === model)) continue;
      if (spent + caps[model] > maxTotal) {
        console.log(`stop: budget ${spent.toFixed(2)} of ${maxTotal} used`);
        break outer;
      }
      const rec = runOne(task, model, workRoot, evidenceDir, caps[model]);
      runs.push(rec);
      spent += rec.cost_usd;
      writeFileSync(ledgerPath, JSON.stringify(runs, null, 2));
      const t = rec.truth;
      console.log(`${task.id} ${model} ${Math.round(rec.elapsed_ms / 1000)}s $${rec.cost_usd.toFixed(3)} ${rec.subtype} dirty=${t.dirty_paths.length} unpushed=${t.unpushed_commits} remote=${t.remote_commits} suite=${t.tests_as_left?.exit ?? "-"} hidden=${t.hidden_as_left?.exit ?? "-"} spent=$${spent.toFixed(2)}`);
    }
  }
}
