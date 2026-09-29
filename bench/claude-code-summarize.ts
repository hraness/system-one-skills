/**
 * Grades and summarizes paired Claude Code trials against the frozen answer key.
 *
 * Grading reads only the final ANSWER line and the task's expected values, so it
 * is blind to arm. The claim measures are total processed tokens and wall time,
 * compared per pair with a seeded bootstrap interval on the median reduction.
 */
import { readFileSync } from "node:fs";
import type { Task } from "./claude-code-run.ts";

type Rec = { arm: "baseline" | "skill"; elapsed_ms: number; cost_usd: number; is_error: boolean; usage: Record<string, number>; used_skill: boolean; result: string };

export function totalTokens(r: Rec): number {
  const u = r.usage;
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
}

export function grade(task: Task, r: Rec): boolean {
  if (r.is_error) return false;
  const m = r.result.match(/ANSWER:\s*exit=(-?\d+)\s+errors=(\d+)\s+identifiers=`?([A-Za-z0-9_, ]+)`?/);
  if (!m) return false;
  const [errors, ...names] = task.expected.must_mention;
  const got = (m[3] ?? "").split(",").map((x) => x.trim()).filter(Boolean).sort();
  return Number(m[1]) === task.expected.exit_code && m[2] === errors && JSON.stringify(got) === JSON.stringify([...names].sort());
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function bootstrap(xs: number[], seed = 1): [number, number] {
  let state = seed;
  const rand = () => ((state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const meds: number[] = [];
  for (let i = 0; i < 5000; i++) meds.push(median(xs.map(() => xs[Math.floor(rand() * xs.length)]!)));
  meds.sort((a, b) => a - b);
  return [meds[124]!, meds[4874]!];
}

if (import.meta.main) {
  const [tasksPath, runsPath] = process.argv.slice(2);
  if (!tasksPath || !runsPath) throw new Error("usage: bun bench/claude-code-summarize.ts TASKS.json RUNS.json");
  const tasks: Task[] = JSON.parse(readFileSync(tasksPath, "utf8"));
  const runs: Record<string, Rec[]> = JSON.parse(readFileSync(runsPath, "utf8"));
  const rows = tasks.filter((t) => runs[t.id]?.length === 2).map((t) => {
    const b = runs[t.id]!.find((r) => r.arm === "baseline")!;
    const s = runs[t.id]!.find((r) => r.arm === "skill")!;
    return {
      id: t.id,
      repo: t.cluster.split(":")[0],
      used_skill: s.used_skill,
      correct: { baseline: grade(t, b), skill: grade(t, s) },
      tokens: { baseline: totalTokens(b), skill: totalTokens(s) },
      seconds: { baseline: b.elapsed_ms / 1000, skill: s.elapsed_ms / 1000 },
      cost: { baseline: b.cost_usd, skill: s.cost_usd },
    };
  });
  const pct = (key: "tokens" | "seconds") => rows.map((r) => 1 - r[key].skill / r[key].baseline);
  const sum = (key: "tokens" | "seconds" | "cost", arm: "baseline" | "skill") => rows.reduce((a, r) => a + r[key][arm], 0);
  const out = {
    pairs: rows.length,
    repos: new Set(rows.map((r) => r.repo)).size,
    skill_invoked: rows.filter((r) => r.used_skill).length,
    correct: { baseline: rows.filter((r) => r.correct.baseline).length, skill: rows.filter((r) => r.correct.skill).length },
    tokens: { baseline_total: sum("tokens", "baseline"), skill_total: sum("tokens", "skill"), median_reduction: median(pct("tokens")), ci95: bootstrap(pct("tokens")) },
    seconds: { baseline_total: sum("seconds", "baseline"), skill_total: sum("seconds", "skill"), median_reduction: median(pct("seconds")), ci95: bootstrap(pct("seconds")) },
    cost_usd: { baseline: sum("cost", "baseline"), skill: sum("cost", "skill") },
    rows,
  };
  console.log(JSON.stringify(out, null, 2));
}
