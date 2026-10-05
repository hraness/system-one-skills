import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { adoptionLine, assertRunOutput, assertSettledAttempts, checkpointArgs, liveDecisionConfig, parseCheckpoint, redactHostedSecrets, withoutHostedCredentials } from "../bench/decision-provider.ts";
import { completionEnv } from "../bench/completion-run.ts";

const credentials = {
  SYS1_BENCH_LIVE: "1", CLOUDFLARE_ACCOUNT_ID: "1".repeat(32), CLOUDFLARE_API_TOKEN: "synthetic-api-token",
  CLOUDFLARE_AUTH_TOKEN: "synthetic-alias-token", TYPESAFE_API_KEY: "synthetic-legacy-key", SYS1_HOME: "inherited-home",
};

function source(name: string) {
  return readFileSync(new URL(`../bench/${name}.ts`, import.meta.url), "utf8");
}

test("current runs default to Cloudflare Clef with explicit live authorization", () => {
  expect(() => liveDecisionConfig({ ...credentials, SYS1_BENCH_LIVE: undefined })).toThrow("SYS1_BENCH_LIVE=1");
  const config = liveDecisionConfig(credentials);
  expect(config.route).toBe("cloudflare/clef");
  expect(config.enableArgs).toEqual(["clef", "enable", "--model", "clef"]);
  expect(config.env.TYPESAFE_API_KEY).toBeUndefined();
  expect(config.env.CLOUDFLARE_AUTH_TOKEN).toBeUndefined();
  expect(config.env.SYS1_HOME).toBeUndefined();
  expect(adoptionLine(config)).toContain("--model cloudflare/clef");
  expect(adoptionLine(config)).not.toContain(credentials.CLOUDFLARE_API_TOKEN);
});

test("credential alias, two-model selection, missing credentials, and explicit legacy reproduction", () => {
  const flash = liveDecisionConfig({ ...credentials, CLOUDFLARE_API_TOKEN: undefined, SYS1_DECISION_MODEL: "clef-flash" });
  expect(flash.route).toBe("cloudflare/clef-flash");
  expect(flash.env.CLOUDFLARE_API_TOKEN).toBe(credentials.CLOUDFLARE_AUTH_TOKEN);
  expect(() => liveDecisionConfig({ ...credentials, CLOUDFLARE_ACCOUNT_ID: "invalid" })).toThrow("CLOUDFLARE_ACCOUNT_ID");
  expect(() => liveDecisionConfig({ ...credentials, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_AUTH_TOKEN: "" })).toThrow("CLOUDFLARE_API_TOKEN");
  expect(() => liveDecisionConfig({ ...credentials, SYS1_DECISION_MODEL: "typesafe/jev-1.13.0" })).toThrow("Clef model");
  expect(() => liveDecisionConfig({ ...credentials, SYS1_DECISION_MODEL: "https://other.invalid/model" })).toThrow("Clef model");
  expect(() => liveDecisionConfig({ ...credentials, SYS1_DECISION_PROVIDER: "other" })).toThrow("SYS1_DECISION_PROVIDER");
  const legacy = liveDecisionConfig({ ...credentials, SYS1_DECISION_PROVIDER: "jev" });
  expect(legacy.route).toBe("typesafe/jev-1.13.0");
  expect(legacy.enableArgs).toEqual(["jev", "enable", "--model", "jev-1.13.0"]);
  for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) expect(legacy.env[key]).toBeUndefined();
  expect(() => liveDecisionConfig({ ...credentials, SYS1_DECISION_PROVIDER: "jev", TYPESAFE_API_KEY: "" })).toThrow("TYPESAFE_API_KEY");
});

test("completion arms strip both providers' credentials without changing their input", () => {
  const before = { ...credentials, GH_TOKEN: "synthetic-github-token", GITHUB_TOKEN: "synthetic-github-token", OTHER: "kept" };
  const completion = completionEnv("work", before);
  for (const env of [withoutHostedCredentials(before), completion]) {
    for (const key of ["TYPESAFE_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SYS1_HOME"]) expect(env[key]).toBeUndefined();
  }
  expect(completion.GH_TOKEN).toBe("");
  expect(completion.GITHUB_TOKEN).toBe("");
  expect(completion.OTHER).toBe("kept");
  expect(before.CLOUDFLARE_API_TOKEN).toBe(credentials.CLOUDFLARE_API_TOKEN);
});

test("uncertain and incomplete attempts block resuming without reconciliation", () => {
  expect(() => assertSettledAttempts({})).not.toThrow();
  expect(() => assertSettledAttempts({ done: { status: "clear", findings: [] } })).not.toThrow();
  for (const ledger of [null, [], { pending: { state: "attempting" } }, { failed: { error: "timeout" } }, { invalid: null }]) {
    expect(() => assertSettledAttempts(ledger)).toThrow();
  }
});

test("checkpoint argv uses the selected route and fixed per-check limits", () => {
  const config = liveDecisionConfig(credentials);
  expect(checkpointArgs(config, 200, 120000, "core-removed-test-assertions", "example.test.ts")).toEqual([
    "review", "checkpoint", "--staged", "--model", "cloudflare/clef", "--max-requests", "200", "--timeout-ms", "120000", "--json", "--rule", "core-removed-test-assertions", "--", "example.test.ts",
  ]);
  expect(checkpointArgs(config, 20, 30000)).toEqual([
    "review", "checkpoint", "--staged", "--model", "cloudflare/clef", "--max-requests", "20", "--timeout-ms", "30000", "--json",
  ]);
  expect(checkpointArgs(liveDecisionConfig({ ...credentials, SYS1_DECISION_MODEL: "clef-flash" }), 200, 120000)).toContain("cloudflare/clef-flash");
});

test("checkpoint envelopes fail closed on malformed finding and probability types", () => {
  expect(parseCheckpoint('{"status":"clear","findings":[],"requests":0}').status).toBe("clear");
  const finding = { rule_id: "rule", path: "example.test.ts", line: 1, model_score: 0.75, confidence: 0.9 };
  expect(parseCheckpoint(JSON.stringify({ status: "findings", findings: [finding] })).findings).toEqual([finding]);
  for (const value of [null, [], {}, { status: "clear", findings: {} }, { status: "findings", findings: [null] }, { status: "clear", findings: [], ok: false }, { status: "clear", findings: [], ok: "true" }, { status: "clear", findings: [], requests: -1 }, { status: "clear", findings: [], audit: { targets: [null] } }]) {
    expect(() => parseCheckpoint(JSON.stringify(value))).toThrow("checkpoint");
  }
  for (const change of [{ path: 1 }, { rule_id: false }, { rule: false }, { line: 0 }, { model_score: "0.7" }, { confidence: -0.1 }, { probability: 1.1 }, { model_score: null }]) {
    expect(() => parseCheckpoint(JSON.stringify({ status: "findings", findings: [{ ...finding, ...change }] }))).toThrow("checkpoint");
  }
  expect(() => parseCheckpoint('{"status":"findings","findings":[{"rule":"rule","path":"x","model_score":1e999}]}')).toThrow("checkpoint");
});

test("runners reject output paths in frozen historical evidence", () => {
  for (const path of ["bench/report/new.json", "docs/evidence/new", "research/history/v0.4.0/new.json"]) expect(() => assertRunOutput(path)).toThrow("Historical evidence is frozen");
  expect(() => assertRunOutput("new-clef-results.json")).not.toThrow();
});

test("recorded output redacts either provider's raw and trimmed token", () => {
  const text = Object.values(credentials).join(" ");
  const redacted = redactHostedSecrets(text, credentials);
  for (const key of ["TYPESAFE_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN"] as const) expect(redacted).not.toContain(credentials[key]);
  expect(redactHostedSecrets("token", { CLOUDFLARE_API_TOKEN: " token " })).toBe("[redacted]");
});

test("runners use shared parsing, bounded subprocesses, and durable attempts without keyfile reads", () => {
  for (const name of ["assertion-recall", "review-recall"]) {
    const text = source(name);
    expect(text).toContain("checkpointArgs(");
    expect(text).toContain("parseCheckpoint(");
    expect(text).toContain("r.error || r.signal");
    expect(text).toContain("state: \"attempting\"");
    expect(text).toContain("assertSettledAttempts(ledger)");
    expect(text).not.toContain("readFileSync(keyFile");
  }
  const paired = source("claude-code-review-run");
  expect(paired).toContain("withoutHostedCredentials(process.env)");
  expect(paired).toContain("enableDecision(\"sys1\"");
  expect(paired).toContain("records.length !== 2");
  expect(paired).toContain("r.error || r.signal");
});
