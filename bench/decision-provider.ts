import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function assertRunOutput(path: string) {
  let existing = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    suffix.unshift(basename(existing));
    existing = dirname(existing);
  }
  const target = relative(realpathSync(ROOT), resolve(realpathSync(existing), ...suffix)).replaceAll("\\", "/");
  if (["bench/report", "docs/evidence", "research/history"].some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) {
    throw new Error("Historical evidence is frozen; choose a new output path outside the evidence directories");
  }
}

export type DecisionConfig = {
  provider: "clef" | "jev";
  model: string;
  route: string;
  env: NodeJS.ProcessEnv;
  enableArgs: string[];
};

export function withoutHostedCredentials(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of ["TYPESAFE_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SYS1_HOME"]) delete env[key];
  return env;
}

export function liveDecisionConfig(source: NodeJS.ProcessEnv = process.env): DecisionConfig {
  if (source.SYS1_BENCH_LIVE !== "1") throw new Error("Paid benchmark runs require SYS1_BENCH_LIVE=1");
  const provider = source.SYS1_DECISION_PROVIDER ?? "clef";
  if (provider !== "clef" && provider !== "jev") throw new Error("SYS1_DECISION_PROVIDER must be clef or jev");
  const model = source.SYS1_DECISION_MODEL ?? (provider === "clef" ? "clef" : "jev-1.13.0");
  const env = withoutHostedCredentials(source);
  if (provider === "clef") {
    if (model !== "clef" && model !== "clef-flash") throw new Error("Clef model must be clef or clef-flash");
    const token = source.CLOUDFLARE_API_TOKEN?.trim() || source.CLOUDFLARE_AUTH_TOKEN?.trim();
    if (!/^[a-fA-F0-9]{32}$/.test(source.CLOUDFLARE_ACCOUNT_ID ?? "") || !token) {
      throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AUTH_TOKEN)");
    }
    env.CLOUDFLARE_ACCOUNT_ID = source.CLOUDFLARE_ACCOUNT_ID;
    env.CLOUDFLARE_API_TOKEN = token;
  } else {
    if (model !== "jev-1.13.0") throw new Error("Legacy reproduction requires jev-1.13.0");
    if (!source.TYPESAFE_API_KEY?.trim()) throw new Error("Legacy reproduction requires TYPESAFE_API_KEY");
    env.TYPESAFE_API_KEY = source.TYPESAFE_API_KEY.trim();
  }
  return { provider, model, route: `${provider === "clef" ? "cloudflare" : "typesafe"}/${model}`, env,
    enableArgs: [provider, "enable", "--model", model] };
}

export function assertSettledAttempts(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid benchmark ledger");
  for (const record of Object.values(value)) {
    if (typeof record !== "object" || record === null || Array.isArray(record) || record.state === "attempting" || "error" in record) {
      throw new Error("An uncertain attempt is recorded; reconcile it before continuing");
    }
  }
}

export function checkpointArgs(config: DecisionConfig, maxRequests: number, timeoutMs: number, rule?: string, path?: string): string[] {
  const args = ["review", "checkpoint", "--staged", "--model", config.route, "--max-requests", String(maxRequests), "--timeout-ms", String(timeoutMs), "--json"];
  if (rule) args.push("--rule", rule);
  if (path) args.push("--", path);
  return args;
}

export type CheckpointFinding = {
  rule_id?: string; rule?: string; path: string; line?: number;
  model_score?: number; confidence?: number; probability?: number;
};

export type CheckpointResult = {
  status: "clear" | "findings";
  findings: CheckpointFinding[];
  requests?: number;
  audit?: { targets?: { path: string }[]; usage?: unknown; units?: unknown; evaluated_units?: unknown };
};

export function parseCheckpoint(text: string): CheckpointResult {
  const value: unknown = JSON.parse(text);
  const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const fail = () => { throw new Error("Invalid checkpoint response"); };
  if (!record(value)) return fail();
  if ((value.ok !== undefined && value.ok !== true) || !["clear", "findings"].includes(value.status as string) || !Array.isArray(value.findings)) return fail();
  if (value.requests !== undefined && (typeof value.requests !== "number" || !Number.isSafeInteger(value.requests) || value.requests < 0)) return fail();
  for (const finding of value.findings) {
    if (!record(finding) || typeof finding.path !== "string" || !finding.path || typeof (finding.rule_id ?? finding.rule) !== "string" || !(finding.rule_id ?? finding.rule)) return fail();
    for (const key of ["rule_id", "rule"]) {
      if (finding[key] !== undefined && (typeof finding[key] !== "string" || !finding[key])) return fail();
    }
    if (finding.line !== undefined && (typeof finding.line !== "number" || !Number.isSafeInteger(finding.line) || finding.line < 1)) return fail();
    for (const key of ["model_score", "confidence", "probability"]) {
      const score = finding[key];
      if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1)) return fail();
    }
  }
  if (value.audit !== undefined) {
    if (!record(value.audit)) return fail();
    if (value.audit.targets !== undefined && (!Array.isArray(value.audit.targets) || value.audit.targets.some((target) => !record(target) || typeof target.path !== "string"))) return fail();
  }
  return value as unknown as CheckpointResult;
}

export function enableDecision(command: string, prefix: string[], home: string, config: DecisionConfig) {
  const result = spawnSync(command, [...prefix, ...config.enableArgs], {
    encoding: "utf8", timeout: 30_000, env: { ...config.env, SYS1_HOME: home },
  });
  if (result.status !== 0) throw new Error(`sys1 ${config.provider} enable failed (exit ${result.status})`);
}

export function redactHostedSecrets(text: string, source: NodeJS.ProcessEnv): string {
  let redacted = text;
  for (const key of ["TYPESAFE_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN"]) {
    for (const value of new Set([source[key], source[key]?.trim()])) {
      if (value) redacted = redacted.split(value).join("[redacted]");
    }
  }
  return redacted;
}

export function adoptionLine(config: DecisionConfig): string {
  const host = config.provider === "clef" ? "Cloudflare Clef" : "legacy hosted Jev";
  return `\nThis repository uses Sys1 review as its review checkpoint, with route \`${config.route}\`. Sending staged source to ${host} is authorized. Use \`sys1 review checkpoint --staged --model ${config.route}\` for this check.\n`;
}
