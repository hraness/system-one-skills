/** Read-only census and report reproduction for the published completion study. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { buildCompletionReport, parseUniqueJson } from "./completion-report.ts";
import { MODELS } from "./completion-run.ts";
import { CLAIMS, GRADER_MODEL, GRADER_PROMPT, GRADER_PROMPT_V1, validateExtraction, type Extraction } from "./completion-grade.ts";

// Frozen tasks.json at dce78d8; this identifies the task set, not any outcome.
export const FROZEN_TASKS_SHA256 = "162caafd98b37f0514150f2e85abdd1f1e0fae51e840a81d5ff7c191ff744c89";
export const AUDIT_SEED = "completion-audit-2026-09";
export const GRADING_SEED = "completion-grade-2026-09";
export const REQUIRED_EVIDENCE_ARTIFACTS = [
  "tasks.json", "runs.json", "grades.json", "reviews.json", "report.json", "audit.json",
  "grades-v1.json", "grading-order.json", "audit-order.json", "exclusions.json", "provenance.json",
  "grading-metadata.json", "grading-prompts.json", "message-projections.json",
  "audit-v1.json", "quote-repairs-v1.json",
] as const;

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function hash(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name}: invalid SHA-256`);
}
function sameKeys(value: Record<string, unknown>, keys: string[], name: string) {
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) throw new Error(`${name}: missing or unknown keys`);
}
function runMap(value: unknown) {
  if (!Array.isArray(value)) throw new Error("runs must be an array");
  const runs = new Map<string, Record<string, unknown>>();
  for (const item of value) {
    const run = object(item, "run");
    if (typeof run.task !== "string" || typeof run.model !== "string" || typeof run.final_message !== "string") throw new Error("invalid run identity or message");
    const key = `${run.task}:${run.model}`;
    if (runs.has(key)) throw new Error(`duplicate task/model run: ${key}`);
    runs.set(key, run);
  }
  return runs;
}

/** Validate the complete extraction history without comparing labels to observed outcomes. */
export function validateCompletionGradingHistory(orderValue: unknown, runsValue: unknown, gradesValue: unknown) {
  const runs = runMap(runsValue);
  if (runs.size !== 60) throw new Error("grading history requires exactly 60 runs");
  const order = object(orderValue, "grading order");
  sameKeys(order, ["seed", "keys"], "grading order");
  if (order.seed !== GRADING_SEED) throw new Error("grading order: unexpected seed");
  const ranked = [...runs.keys()].sort((a, b) => sha256(`${GRADING_SEED}:${a}`).localeCompare(sha256(`${GRADING_SEED}:${b}`)));
  if (!isDeepStrictEqual(order.keys, ranked)) throw new Error("grading order differs from the complete frozen seeded order");
  const grades = object(gradesValue, "v1 grades");
  sameKeys(grades, [...runs.keys()], "v1 grades");
  for (const [key, run] of runs) {
    const extraction = object(grades[key], `v1 labels ${key}`);
    sameKeys(extraction, [...CLAIMS], `v1 labels ${key}`);
    for (const claim of CLAIMS) {
      sameKeys(object(extraction[claim], `v1 label ${key}.${claim}`), ["claimed", "quote"], `v1 label ${key}.${claim}`);
    }
    validateExtraction(extraction, run.final_message as string);
  }
  return { runs: runs.size, labels: runs.size * CLAIMS.length };
}

/** Bind all graded inputs to their public messages without exposing removed source text. */
export function validateCompletionGradingBindings(metadataValue: unknown, promptsValue: unknown, projectionsValue: unknown, runsValue: unknown, auditValue: unknown) {
  const runs = runMap(runsValue);
  if (runs.size !== 60) throw new Error("grading bindings require exactly 60 runs");
  const metadata = object(metadataValue, "grading metadata");
  sameKeys(metadata, ["version", "model", "prompt_sha256", "seed", "messages_sha256"], "grading metadata");
  if (metadata.version !== 1 || metadata.model !== GRADER_MODEL || metadata.seed !== GRADING_SEED) throw new Error("grading metadata: unexpected version, model or seed");
  hash(metadata.prompt_sha256, "grading metadata prompt_sha256");
  const messages = object(metadata.messages_sha256, "grading metadata messages_sha256");
  sameKeys(messages, [...runs.keys()], "grading metadata messages_sha256");
  for (const [key, digest] of Object.entries(messages)) hash(digest, `graded message ${key}`);

  const prompts = object(promptsValue, "grading prompts");
  sameKeys(prompts, ["model", "v1", "final"], "grading prompts");
  if (prompts.model !== GRADER_MODEL) throw new Error("grading prompts: unexpected model");
  for (const [name, expected] of [["v1", GRADER_PROMPT_V1], ["final", GRADER_PROMPT]] as const) {
    const prompt = object(prompts[name], `grading prompt ${name}`);
    sameKeys(prompt, ["text", "sha256"], `grading prompt ${name}`);
    if (typeof prompt.text !== "string" || prompt.text !== expected) throw new Error(`unexpected grading prompt text: ${name}`);
    hash(prompt.sha256, `grading prompt ${name}`);
    if (prompt.sha256 !== sha256(prompt.text)) throw new Error(`grading prompt SHA-256 mismatch: ${name}`);
    if (name === "final" && metadata.prompt_sha256 !== prompt.sha256) throw new Error("grading metadata prompt SHA-256 differs from final prompt");
  }

  if (!Array.isArray(projectionsValue) || projectionsValue.length !== runs.size) throw new Error("grading bindings require exactly 60 message projections");
  const projections = new Map<string, Record<string, unknown>>();
  for (const item of projectionsValue) {
    const row = object(item, "message projection");
    sameKeys(row, ["key", "source_message_sha256", "grading_message_sha256", "public_message_sha256", "redactions"], "message projection");
    if (typeof row.key !== "string" || !runs.has(row.key) || projections.has(row.key)) throw new Error("unknown or duplicate message projection");
    projections.set(row.key, row);
    for (const name of ["source_message_sha256", "grading_message_sha256", "public_message_sha256"]) hash(row[name], `message projection ${row.key}.${name}`);
    if (row.grading_message_sha256 !== messages[row.key]) throw new Error(`message projection differs from graded message SHA-256: ${row.key}`);
    if (row.public_message_sha256 !== sha256(runs.get(row.key)!.final_message as string)) throw new Error(`message projection public SHA-256 mismatch: ${row.key}`);
    if (!Array.isArray(row.redactions)) throw new Error(`message projection redactions must be an array: ${row.key}`);
    for (const item of row.redactions) {
      const redaction = object(item, `message redaction ${row.key}`);
      sameKeys(redaction, ["replacement", "occurrences"], `message redaction ${row.key}`);
      if (typeof redaction.replacement !== "string" || !redaction.replacement.trim() || typeof redaction.occurrences !== "number" || !Number.isSafeInteger(redaction.occurrences) || redaction.occurrences <= 0) throw new Error(`invalid message redaction: ${row.key}`);
    }
    if ((row.source_message_sha256 === row.grading_message_sha256) !== (row.redactions.length === 0)) throw new Error(`message redactions disagree with source and grading hashes: ${row.key}`);
  }

  // These links reconcile retained hashes; replacement-only descriptions cannot
  // independently reconstruct or verify the intentionally omitted source text.
  const audit = object(auditValue, "audit");
  if (!Array.isArray(audit.cases) || audit.cases.length !== 20) throw new Error("grading bindings require exactly 20 audit cases");
  const audited = new Set<string>();
  for (const item of audit.cases) {
    const row = object(item, "audit case");
    if (typeof row.run !== "string" || !projections.has(row.run) || audited.has(row.run)) throw new Error("unknown or duplicate audit run in grading bindings");
    audited.add(row.run);
    const projection = projections.get(row.run)!;
    for (const name of ["source_message_sha256", "grading_message_sha256"] as const) {
      hash(row[name], `audit ${row.run}.${name}`);
      if (row[name] !== projection[name]) throw new Error(`audit ${name} differs from message projection: ${row.run}`);
    }
    if (row.message_sha256 !== projection.public_message_sha256) throw new Error(`audit public message SHA-256 differs from message projection: ${row.run}`);
  }
  return { runs: runs.size, audited_messages: audited.size };
}

/** Reproduce the independent label comparison, never the study's outcome scores. */
export function validateCompletionAudit(auditValue: unknown, orderValue: unknown, runsValue: unknown, gradesValue: unknown, mode: "source" | "published" = "published", expected: "passed" | "failed-v1" = "passed") {
  const runs = runMap(runsValue);
  const grades = object(gradesValue, "grades");
  const order = object(orderValue, "audit order");
  const mapping = object(order.mapping, "audit mapping");
  const ids = Array.from({ length: 20 }, (_, i) => `audit-${String(i + 1).padStart(2, "0")}`);
  sameKeys(mapping, ids, "audit mapping");
  if (order.seed !== AUDIT_SEED) throw new Error("audit order: unexpected seed");
  const ranked = [...runs.keys()].sort((a, b) => sha256(`${AUDIT_SEED}:${a}`).localeCompare(sha256(`${AUDIT_SEED}:${b}`)));
  for (const [i, id] of ids.entries()) {
    if (typeof mapping[id] !== "string" || mapping[id] !== ranked[i]) throw new Error(`audit mapping differs from frozen seeded order: ${id}`);
  }
  const audit = object(auditValue, "audit");
  if (typeof audit.version !== "string" || !audit.version.trim() || audit.seed !== AUDIT_SEED) throw new Error("invalid audit version or seed");
  if (audit.messages !== 20 || audit.labels !== 80 || audit.allowed_disagreements !== 2) throw new Error("invalid audit counts or disagreement allowance");
  if (!Array.isArray(audit.cases) || audit.cases.length !== 20) throw new Error("audit must contain exactly 20 cases");
  const seen = new Set<string>();
  const differences: unknown[] = [];
  for (const item of audit.cases) {
    const row = object(item, "audit case");
    if (typeof row.audit_id !== "string" || !ids.includes(row.audit_id) || seen.has(row.audit_id)) throw new Error("unknown or duplicate audit case");
    seen.add(row.audit_id);
    if (row.run !== mapping[row.audit_id]) throw new Error(`audit case mapping mismatch: ${row.audit_id}`);
    const key = row.run as string;
    const message = runs.get(key)!.final_message as string;
    if (row.message_sha256 !== sha256(message)) throw new Error(`audit message SHA-256 mismatch: ${row.audit_id}`);
    if (mode === "published") hash(row.source_message_sha256, `audit ${row.audit_id}.source_message_sha256`);
    sameKeys(object(row.independent, "independent labels"), [...CLAIMS], "independent labels");
    sameKeys(object(row.grader, "audit grader labels"), [...CLAIMS], "audit grader labels");
    const independent = validateExtraction(row.independent, message);
    const grader = validateExtraction(row.grader, message);
    const finalGrade = validateExtraction(grades[key], message);
    if (!isDeepStrictEqual(grader, finalGrade)) throw new Error(`audit grader differs from final grades: ${key}`);
    const differing = CLAIMS.filter((claim) => independent[claim].claimed !== grader[claim].claimed);
    if (!isDeepStrictEqual(row.disagreements, differing)) throw new Error(`audit case disagreement mismatch: ${row.audit_id}`);
    differences.push(...differing.map((claim) => ({ audit_id: row.audit_id, run: key, claim, independent: independent[claim], grader: grader[claim] })));
  }
  if (audit.disagreements !== differences.length || !isDeepStrictEqual(audit.disagreement_details, differences)) throw new Error("audit disagreement totals or details do not reproduce");
  if (expected === "failed-v1") {
    if (audit.version !== "v1" || differences.length <= 2 || audit.status !== "requires_prompt_revision_and_full_regrade") throw new Error("v1 audit must require prompt revision and full regrade");
  } else if (differences.length > 2 || audit.status !== "passed") throw new Error("blind grading audit has not passed");
  return { messages: seen.size, labels: seen.size * CLAIMS.length, disagreements: differences.length };
}

/** Preserve the failed audit and the independent Boolean labels locked before regrading. */
export function validateCompletionAuditHistory(v1Value: unknown, finalValue: unknown, orderValue: unknown, runsValue: unknown, gradesV1Value: unknown, projectionsValue: unknown) {
  const result = validateCompletionAudit(v1Value, orderValue, runsValue, gradesV1Value, "published", "failed-v1");
  const runs = runMap(runsValue);
  if (!Array.isArray(projectionsValue) || projectionsValue.length !== runs.size) throw new Error("audit history requires complete message projections");
  const projections = new Map<string, Record<string, unknown>>();
  for (const item of projectionsValue) {
    const row = object(item, "message projection");
    if (typeof row.key !== "string" || !runs.has(row.key) || projections.has(row.key)) throw new Error("unknown or duplicate audit-history message projection");
    hash(row.source_message_sha256, `message projection ${row.key}.source_message_sha256`);
    hash(row.public_message_sha256, `message projection ${row.key}.public_message_sha256`);
    if (row.public_message_sha256 !== sha256(runs.get(row.key)!.final_message as string)) throw new Error(`audit-history public message SHA-256 mismatch: ${row.key}`);
    projections.set(row.key, row);
  }
  const final = object(finalValue, "final audit");
  if (!Array.isArray(final.cases) || final.cases.length !== 20) throw new Error("audit history requires exactly 20 final audit cases");
  const locked = new Map<string, Record<string, unknown>>();
  for (const item of final.cases) {
    const row = object(item, "final audit case");
    if (typeof row.audit_id !== "string" || locked.has(row.audit_id)) throw new Error("invalid or duplicate final audit ID in audit history");
    locked.set(row.audit_id, row);
  }
  const v1 = object(v1Value, "v1 audit");
  for (const item of v1.cases as unknown[]) {
    const row = object(item, "v1 audit case");
    const key = row.run as string;
    const projection = projections.get(key)!;
    if (row.source_message_sha256 !== projection.source_message_sha256 || row.message_sha256 !== projection.public_message_sha256) throw new Error(`v1 audit hashes differ from message projection: ${key}`);
    const finalRow = locked.get(row.audit_id as string);
    if (!finalRow || finalRow.run !== key) throw new Error(`v1 and final audit sample differ: ${row.audit_id}`);
    const independent = validateExtraction(row.independent, runs.get(key)!.final_message as string);
    sameKeys(object(finalRow.independent, "final independent labels"), [...CLAIMS], "final independent labels");
    const finalIndependent = validateExtraction(finalRow.independent, runs.get(key)!.final_message as string);
    for (const claim of CLAIMS) {
      if (independent[claim].claimed !== finalIndependent[claim].claimed) throw new Error(`locked independent Boolean label changed: ${row.audit_id}.${claim}`);
    }
  }
  return result;
}

function repairExtraction(value: unknown, name: string, message?: string) {
  const extraction = object(value, name);
  sameKeys(extraction, [...CLAIMS], name);
  for (const claim of CLAIMS) {
    const label = object(extraction[claim], `${name}.${claim}`);
    sameKeys(label, ["claimed", "quote"], `${name}.${claim}`);
    if (typeof label.claimed !== "boolean" || typeof label.quote !== "string") throw new Error(`invalid quote-repair label: ${name}.${claim}`);
  }
  // The original quotes are retained precisely because they could be unsupported.
  return message === undefined ? extraction as Extraction : validateExtraction(extraction, message);
}

/** Verify public quote repairs without pretending to authenticate omitted private receipts. */
export function validateCompletionQuoteRepairs(value: unknown, runsValue: unknown, gradesV1Value: unknown) {
  if (!Array.isArray(value)) throw new Error("quote repairs must be an array");
  const runs = runMap(runsValue);
  const grades = object(gradesV1Value, "v1 grades");
  sameKeys(grades, [...runs.keys()], "v1 grades");
  const seen = new Set<string>();
  for (const item of value) {
    const row = object(item, "quote repair");
    sameKeys(row, ["key", "source_receipt", "source_sha256", "original_extraction", "repaired_extraction", "unchanged_boolean_labels", "reason"], "quote repair");
    if (typeof row.key !== "string" || !runs.has(row.key) || seen.has(row.key)) throw new Error("unknown or duplicate quote-repair key");
    seen.add(row.key);
    if (typeof row.source_receipt !== "string" || !row.source_receipt.trim() || typeof row.reason !== "string" || !row.reason.trim()) throw new Error(`quote repair lacks receipt or reason: ${row.key}`);
    hash(row.source_sha256, `quote-repair receipt ${row.key}`);
    if (row.unchanged_boolean_labels !== true) throw new Error(`quote repair must preserve Boolean labels: ${row.key}`);
    const original = repairExtraction(row.original_extraction, `original quote repair ${row.key}`);
    const message = runs.get(row.key)!.final_message as string;
    const repaired = repairExtraction(row.repaired_extraction, `repaired quote repair ${row.key}`, message);
    const grade = repairExtraction(grades[row.key], `v1 grade ${row.key}`, message);
    for (const claim of CLAIMS) {
      if (original[claim].claimed !== repaired[claim].claimed) throw new Error(`quote repair changed Boolean label: ${row.key}.${claim}`);
    }
    if (!isDeepStrictEqual(repaired, grade)) throw new Error(`quote repair differs from v1 grades: ${row.key}`);
  }
  return { repairs: seen.size };
}

/** Require one reviewed transcript per run and reconcile the registered exclusions. */
export function validateCompletionExclusions(value: unknown, runsValue: unknown, reviewsValue: unknown) {
  const runs = runMap(runsValue);
  const reviews = object(reviewsValue, "reviews");
  sameKeys(reviews, [...runs.keys()], "exclusion reviews");
  const exclusion = object(value, "exclusions");
  const scope = object(exclusion.scope, "exclusion scope");
  if (scope.covered_runs !== runs.size || scope.tasks !== new Set([...runs.values()].map((run) => run.task)).size || scope.all_transcript_hashes_revalidated !== true) throw new Error("exclusion scope does not cover all runs");
  const counts = object(scope.runs_per_model, "exclusion model counts");
  const models = [...new Set([...runs.values()].map((run) => run.model as string))];
  sameKeys(counts, models, "exclusion model counts");
  for (const model of models) if (counts[model] !== [...runs.values()].filter((run) => run.model === model).length) throw new Error(`exclusion model count mismatch: ${model}`);
  if (!Array.isArray(exclusion.runs)) throw new Error("exclusion runs must be an array");
  const seen = new Set<string>();
  for (const item of exclusion.runs) {
    const row = object(item, "exclusion row");
    const key = `${row.task}:${row.model}`;
    if (!runs.has(key) || seen.has(key)) throw new Error(`unknown or duplicate exclusion row: ${key}`);
    seen.add(key);
    hash(row.sha256, `exclusion ${key}`);
    if (typeof row.registered_leak_exclusion !== "boolean" || typeof row.reason !== "string" || !row.reason.trim()) throw new Error(`invalid exclusion decision: ${key}`);
    const review = object(reviews[key], `review ${key}`);
    if (typeof review.excluded !== "boolean") throw new Error(`invalid reviewed exclusion: ${key}`);
    if (review.excluded && (typeof review.exclusion_reason !== "string" || !review.exclusion_reason.trim())) throw new Error(`missing reviewed exclusion reason: ${key}`);
    const run = runs.get(key)!;
    const result = object(row.result, `reviewed result ${key}`);
    if (typeof result.is_error !== "boolean" || typeof result.subtype !== "string" || typeof result.num_turns !== "number" || !Number.isSafeInteger(result.num_turns) || result.num_turns < 0) throw new Error(`invalid reviewed result metadata: ${key}`);
    if (result.is_error !== run.is_error || result.subtype !== run.subtype || result.num_turns !== run.num_turns) throw new Error(`reviewed result differs from run metadata: ${key}`);
    for (const field of ["actual_final", "harness_used_fallback_text", "fallback_progress_case"]) {
      if (typeof result[field] !== "boolean") throw new Error(`invalid reviewed result ${field}: ${key}`);
    }
    if (typeof review.actual_final !== "boolean" || review.actual_final !== result.actual_final) throw new Error(`reviewed actual_final differs from transcript result: ${key}`);
    if ((result.harness_used_fallback_text && result.actual_final) || (result.fallback_progress_case && !result.harness_used_fallback_text)) throw new Error(`inconsistent reviewed fallback status: ${key}`);
    const startupFailure = run.is_error === true && run.num_turns === 0;
    if (review.excluded !== (row.registered_leak_exclusion || startupFailure)) throw new Error(`exclusion disagrees with reviewed exclusion: ${key}`);
  }
  if (seen.size !== runs.size) throw new Error("missing exclusion rows for frozen runs");
  return { runs: seen.size };
}

/** Require the complete public inventory; additional declared JSON history is allowed. */
export function validateEvidenceArtifacts(directory: string): Record<string, unknown> {
  const read = (name: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(name)) throw new Error(`unsafe artifact name: ${name}`);
    const file = join(directory, name);
    if (!lstatSync(file).isFile()) throw new Error(`artifact must be a regular file, not a symlink: ${name}`);
    return readFileSync(file);
  };
  const provenance = object(parseUniqueJson(read("provenance.json").toString("utf8"), "provenance"), "provenance");
  const inventory = object(provenance.artifacts_sha256, "artifact hash inventory");
  if (Object.hasOwn(inventory, "provenance.json")) throw new Error("provenance must not hash itself");
  for (const name of REQUIRED_EVIDENCE_ARTIFACTS) {
    if (name !== "provenance.json" && !Object.hasOwn(inventory, name)) throw new Error(`missing required artifact hash: ${name}`);
  }
  const entries = readdirSync(directory);
  const unexpected = entries.filter((name) => !name.endsWith(".json"));
  if (unexpected.length) throw new Error(`unexpected evidence directory entries: ${unexpected.join(", ")}`);
  const files = entries.filter((name) => name !== "provenance.json");
  sameKeys(inventory, files, "artifact hash inventory");
  const artifacts: Record<string, unknown> = { "provenance.json": provenance };
  for (const [name, digest] of Object.entries(inventory)) {
    hash(digest, `artifact ${name}`);
    const bytes = read(name);
    if (sha256(bytes) !== digest) throw new Error(`artifact SHA-256 mismatch: ${name}`);
    artifacts[name] = parseUniqueJson(bytes.toString("utf8"), name);
  }
  return artifacts;
}

type EvidenceContents = { tasks: unknown; runs: unknown; grades: unknown; reviews: unknown; report: unknown };

/** Validate the complete frozen run census without computing outcome scores. */
export function validateCompletionCensus(taskValues: unknown, runValues: unknown) {
  if (!Array.isArray(taskValues) || taskValues.length !== 30) throw new Error("expected exactly 30 frozen tasks");
  const tasks = new Set<string>();
  for (const task of taskValues) {
    if (!task || typeof task !== "object" || typeof task.id !== "string" || !task.id) throw new Error("invalid frozen task id");
    if (tasks.has(task.id)) throw new Error(`duplicate frozen task: ${task.id}`);
    tasks.add(task.id);
  }
  if (!Array.isArray(runValues)) throw new Error("runs must be an array");
  const models = Object.keys(MODELS);
  const expected = new Set([...tasks].flatMap((task) => models.map((model) => `${task}:${model}`)));
  const seen = new Set<string>();
  for (const run of runValues) {
    if (!run || typeof run !== "object" || typeof run.task !== "string" || typeof run.model !== "string") throw new Error("invalid run identity");
    if (!tasks.has(run.task) || !models.includes(run.model)) throw new Error(`unknown task/model run: ${run.task}:${run.model}`);
    const key = `${run.task}:${run.model}`;
    if (seen.has(key)) throw new Error(`duplicate task/model run: ${key}`);
    seen.add(key);
  }
  const missing = [...expected].filter((key) => !seen.has(key));
  if (missing.length) throw new Error(`missing frozen task/model runs: ${missing.join(", ")}`);
  return { tasks: tasks.size, models: models.length, runs: seen.size };
}

/** Generic census/reproduction helper; the directory validator also pins the frozen task bytes. */
export function validateEvidenceContents(evidence: EvidenceContents) {
  const census = validateCompletionCensus(evidence.tasks, evidence.runs);
  const rebuilt = buildCompletionReport(evidence.runs, evidence.grades, evidence.reviews, "");
  if (!isDeepStrictEqual(rebuilt, evidence.report)) throw new Error("published report does not match the evidence inputs");
  return census;
}

/** Validates immutable task identity before reading the other published artifacts. */
export function validateCompletionEvidence(directory: string) {
  if (!lstatSync(join(directory, "tasks.json")).isFile()) throw new Error("tasks.json must be a regular file");
  const taskBytes = readFileSync(join(directory, "tasks.json"));
  const hash = createHash("sha256").update(taskBytes).digest("hex");
  if (hash !== FROZEN_TASKS_SHA256) throw new Error(`frozen tasks.json SHA-256 mismatch: ${hash}`);
  const artifacts = validateEvidenceArtifacts(directory);
  const read = (name: string) => artifacts[`${name}.json`];
  validateCompletionGradingBindings(read("grading-metadata"), read("grading-prompts"), read("message-projections"), read("runs"), read("audit"));
  validateCompletionGradingHistory(read("grading-order"), read("runs"), read("grades-v1"));
  validateCompletionAudit(read("audit"), read("audit-order"), read("runs"), read("grades"));
  validateCompletionAuditHistory(read("audit-v1"), read("audit"), read("audit-order"), read("runs"), read("grades-v1"), read("message-projections"));
  validateCompletionQuoteRepairs(read("quote-repairs-v1"), read("runs"), read("grades-v1"));
  validateCompletionExclusions(read("exclusions"), read("runs"), read("reviews"));
  return validateEvidenceContents({
    tasks: parseUniqueJson(taskBytes.toString("utf8"), "tasks"),
    runs: read("runs"),
    grades: read("grades"),
    reviews: read("reviews"),
    report: read("report"),
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]) throw new Error("usage: bun bench/completion-evidence.ts EVIDENCE_DIRECTORY");
  const result = validateCompletionEvidence(args[0]);
  console.log(`reproduced report for ${result.tasks} frozen tasks, ${result.models} models and ${result.runs} runs`);
}
