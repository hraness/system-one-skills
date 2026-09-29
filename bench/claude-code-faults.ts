/**
 * Builds fault-injected typecheck tasks for the Claude Code adapter.
 *
 * For each repository, rename a widely imported export at its definition in a
 * copy-on-write snapshot, run the typecheck once, and keep faults whose output
 * reaches the skill's 8 KiB threshold. The observed exit code, error count, and
 * renamed identifier become the frozen answer key before any agent runs.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "./claude-code-run.ts";

const MIN_BYTES = 8 * 1024;

function sh(cmd: string, args: string[], cwd?: string) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function exportCandidates(repo: string, limit: number): { file: string; name: string; importers: number }[] {
  const files = sh("git", ["ls-files", "*.ts", "*.tsx"], repo).stdout.split("\n")
    .filter((f) => f && !/(^|\/)(test|tests|__tests__)\/|\.test\.|\.d\.ts$|node_modules/.test(f));
  const defs: { file: string; name: string }[] = [];
  for (const file of files) {
    const src = readFileSync(join(repo, file), "utf8");
    for (const m of src.matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z_][A-Za-z0-9_]{3,})/gm)) {
      defs.push({ file, name: m[1]! });
    }
  }
  const scored = defs.map((d) => {
    // git grep's ERE has no \b; -w gives word matching. Count other files using the name.
    const g = sh("git", ["grep", "-l", "-w", d.name, "--", "*.ts", "*.tsx"], repo);
    return { ...d, importers: g.stdout.split("\n").filter((f) => f && f !== d.file).length };
  }).filter((d) => d.importers >= 3).sort((a, b) => b.importers - a.importers);
  const seenFiles = new Set<string>();
  return scored.filter((d) => !seenFiles.has(d.file) && seenFiles.add(d.file)).slice(0, limit);
}

function renameAt(snap: string, file: string, name: string) {
  const path = join(snap, file);
  const src = readFileSync(path, "utf8");
  const next = src.replace(new RegExp(`^(export (?:async )?(?:function|const|class) )${name}\\b`, "m"), `$1${name}Renamed`);
  if (next === src) throw new Error(`definition not found: ${file} ${name}`);
  writeFileSync(path, next);
}

if (import.meta.main) {
  const [reposArg, outDir, perRepoArg] = process.argv.slice(2);
  if (!reposArg || !outDir) throw new Error("usage: bun bench/claude-code-faults.ts repo1,repo2 OUT_DIR [PER_REPO]");
  const perRepo = Number(perRepoArg ?? "4");
  const snapRoot = join(outDir, "snapshots");
  mkdirSync(snapRoot, { recursive: true });
  const tasks: Task[] = [];
  for (const repo of reposArg.split(",")) {
    const name = repo.split("/").at(-1)!;
    // Disjoint pairs of distinct names: each export and each defining file is used by one task only.
    const cands = exportCandidates(repo, perRepo * 4);
    const used = new Set<string>();
    const pairs: [typeof cands[number], typeof cands[number]][] = [];
    for (const a of cands) {
      if (used.has(a.name)) continue;
      const b = cands.find((c) => c !== a && !used.has(c.name) && c.name !== a.name && c.file !== a.file);
      if (!b) break;
      used.add(a.name).add(b.name);
      pairs.push([a, b]);
    }
    let kept = 0;
    for (const [a, b] of pairs) {
      if (kept >= perRepo) break;
      const id = `${name}-${a.name}-${b.name}`;
      const snap = join(snapRoot, id);
      rmSync(snap, { recursive: true, force: true });
      sh("cp", ["-c", "-R", repo, snap]);
      rmSync(join(snap, ".git"), { recursive: true, force: true });
      renameAt(snap, a.file, a.name);
      renameAt(snap, b.file, b.name);
      const run = sh("bash", ["-lc", "bun run typecheck 2>&1"], snap);
      const out = run.stdout ?? "";
      const errors = (out.match(/error TS\d+/g) ?? []).length;
      const bytes = Buffer.byteLength(out);
      const mentions = [a.name, b.name].every((n) => out.includes(n));
      if (bytes < MIN_BYTES || errors === 0 || !mentions) {
        rmSync(snap, { recursive: true, force: true });
        console.log(`skip ${id}: ${bytes} bytes, ${errors} errors, mentions=${mentions}`);
        continue;
      }
      kept++;
      tasks.push({
        id,
        cluster: `${name}:${a.name}+${b.name}`,
        repo: snap,
        command: "bun run typecheck",
        expected: { exit_code: run.status ?? -1, must_mention: [String(errors), a.name, b.name] },
        prompt: [
          "Run `bun run typecheck` in this repository. It is known to produce long output.",
          "Report whether it passes, its exit code, the total number of TypeScript errors,",
          "and the identifiers whose missing exports cause them.",
          "Do not modify any files. End with one line:",
          "`ANSWER: exit=<code> errors=<n> identifiers=<name>,<name>`.",
        ].join(" "),
      });
      console.log(`keep ${id}: ${bytes} bytes, ${errors} errors, exit ${run.status}`);
      writeFileSync(join(outDir, "tasks.json"), JSON.stringify(tasks, null, 2));
    }
  }
  writeFileSync(join(outDir, "tasks.json"), JSON.stringify(tasks, null, 2));
  console.log(`${tasks.length} tasks`);
}
