import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CLAIMS, GRADER_MODEL, GRADER_PROMPT, GRADER_PROMPT_V1, gradingIdentity, type Extraction } from "./completion-grade.ts";
import { buildCompletionReport, type CompletionReview } from "./completion-report.ts";
import { MODELS, type ModelKey, type RunRecord } from "./completion-run.ts";
import { AUDIT_SEED, GRADING_SEED, REQUIRED_EVIDENCE_ARTIFACTS, validateCompletionAudit, validateCompletionAuditHistory, validateCompletionEvidence, validateCompletionExclusions, validateCompletionGradingBindings, validateCompletionGradingHistory, validateCompletionQuoteRepairs, validateEvidenceArtifacts, validateEvidenceContents } from "./completion-evidence.ts";

function fixture(tasks = Array.from({ length: 30 }, (_, i) => ({ id: `task-${String(i).padStart(8, "0")}` }))) {
  const runs = tasks.flatMap((task) => (Object.keys(MODELS) as ModelKey[]).map((model): RunRecord => ({
    task: task.id, model, session: "redacted", elapsed_ms: 1_000, cost_usd: 0.1,
    is_error: false, subtype: "success", num_turns: 1,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    max_tool_result_bytes: 0, final_message: "No completion claims.",
    truth: { dirty_paths: [], local_commits: 0, remote_commits: 0, unpushed_commits: 0,
      tests_as_left: { exit: 0, ran: "", tail: "" }, hidden_as_left: { exit: 0, ran: "", tail: "" } },
  })));
  const grades = Object.fromEntries(runs.map((run) => [key(run), Object.fromEntries(
    CLAIMS.map((claim) => [claim, { claimed: false, quote: "" }]),
  ) as Extraction]));
  const reviews: Record<string, CompletionReview> = Object.fromEntries(runs.map((run) => [key(run), {
    excluded: false, exclusion_reason: "", actual_final: true, confirmed_false_claims: [], reason: "No claims to contradict.",
  } satisfies CompletionReview]));
  return { tasks, runs, grades, reviews, report: buildCompletionReport(runs, grades, reviews, "") };
}
const key = (run: RunRecord) => `${run.task}:${run.model}`;
const rebuild = (evidence: ReturnType<typeof fixture>) => { evidence.report = buildCompletionReport(evidence.runs, evidence.grades, evidence.reviews, ""); };

describe("published completion evidence census", () => {
  test("reproduces all 60 task/model runs and ignores object key order", () => {
    const evidence = fixture();
    expect(validateEvidenceContents(evidence)).toEqual({ tasks: 30, models: 2, runs: 60 });
    evidence.report = Object.fromEntries(Object.entries(evidence.report).reverse()) as typeof evidence.report;
    evidence.report.models = Object.fromEntries(Object.entries(evidence.report.models).reverse());
    expect(validateEvidenceContents(evidence).runs).toBe(60);
  });

  test("rejects an omitted run even when the report is self-consistent", () => {
    const evidence = fixture();
    const omitted = evidence.runs.pop()!;
    delete evidence.grades[key(omitted)];
    delete evidence.reviews[key(omitted)];
    rebuild(evidence);
    expect(() => validateEvidenceContents(evidence)).toThrow("missing frozen task/model");
  });

  test("rejects a substituted task run even when labels and report agree", () => {
    const evidence = fixture();
    const run = evidence.runs[0]!;
    const oldKey = key(run);
    run.task = "substituted-task";
    evidence.grades[key(run)] = evidence.grades[oldKey]!;
    evidence.reviews[key(run)] = evidence.reviews[oldKey]!;
    delete evidence.grades[oldKey];
    delete evidence.reviews[oldKey];
    rebuild(evidence);
    expect(() => validateEvidenceContents(evidence)).toThrow("unknown task/model");
  });

  test("rejects duplicated tasks, duplicated runs and unknown models", () => {
    const duplicateTask = fixture();
    duplicateTask.tasks[29] = duplicateTask.tasks[0]!;
    expect(() => validateEvidenceContents(duplicateTask)).toThrow("duplicate frozen task");
    const duplicateRun = fixture();
    duplicateRun.runs[59] = duplicateRun.runs[0]!;
    expect(() => validateEvidenceContents(duplicateRun)).toThrow("duplicate task/model");
    const unknownModel = fixture();
    unknownModel.runs[0]!.model = "other" as ModelKey;
    expect(() => validateEvidenceContents(unknownModel)).toThrow("unknown task/model");
    const shortTasks = fixture();
    shortTasks.tasks.pop();
    expect(() => validateEvidenceContents(shortTasks)).toThrow("exactly 30");
  });

  test("rejects drifted statistics and per-run array order", () => {
    const stats = fixture();
    stats.report.models.sonnet!.mechanical.false_claim_runs = 1;
    expect(() => validateEvidenceContents(stats)).toThrow("does not match");
    const ordered = fixture();
    ordered.report.runs.reverse();
    expect(() => validateEvidenceContents(ordered)).toThrow("does not match");
  });

  test("rejects missing labels or reviews instead of reproducing partial input", () => {
    const evidence = fixture();
    delete evidence.grades[key(evidence.runs[0]!)];
    expect(() => validateEvidenceContents(evidence)).toThrow("missing key");
    const missingReview = fixture();
    delete missingReview.reviews[key(missingReview.runs[0]!)];
    expect(() => validateEvidenceContents(missingReview)).toThrow("missing key");
  });

  test("directory and CLI reject missing or substituted task bytes without rewriting evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-evidence-"));
    try {
      expect(() => validateCompletionEvidence(dir)).toThrow("ENOENT");
      const taskFile = join(dir, "tasks.json");
      const bytes = JSON.stringify(fixture().tasks);
      writeFileSync(taskFile, bytes);
      expect(() => validateCompletionEvidence(dir)).toThrow("SHA-256 mismatch");
      const result = spawnSync(process.execPath, [join(import.meta.dir, "completion-evidence.ts"), dir], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("SHA-256 mismatch");
      expect(readFileSync(taskFile, "utf8")).toBe(bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const gradingOrder = (runs: RunRecord[]) => ({
  seed: GRADING_SEED,
  keys: runs.map(key).sort((a, b) => digest(`${GRADING_SEED}:${a}`).localeCompare(digest(`${GRADING_SEED}:${b}`))),
});

describe("published grading history", () => {
  test("requires the complete seeded order and accepts verbatim scoped claims", () => {
    const e = fixture();
    const run = e.runs[0]!;
    run.final_message = "Focused tests pass; the deployment is unfinished.";
    e.grades[key(run)]!.tests_pass = { claimed: true, quote: "Focused tests pass" };
    const order = gradingOrder(e.runs);
    expect(validateCompletionGradingHistory(order, e.runs, e.grades)).toEqual({ runs: 60, labels: 240 });
    e.runs.reverse();
    expect(validateCompletionGradingHistory(order, e.runs, Object.fromEntries(Object.entries(e.grades).reverse())).runs).toBe(60);
  });

  test("rejects missing, malformed, reordered, omitted, duplicate or substituted grading keys", () => {
    const e = fixture();
    const order = gradingOrder(e.runs);
    const malformed = [
      {}, { ...order, seed: "different-seed" }, { ...order, keys: {} },
      { ...order, keys: [...order.keys].reverse() }, { ...order, keys: order.keys.slice(1) },
      { ...order, keys: [order.keys[1], ...order.keys.slice(1)] },
      { ...order, keys: ["unknown:haiku", ...order.keys.slice(1)] },
    ];
    for (const value of malformed) expect(() => validateCompletionGradingHistory(value, e.runs, e.grades)).toThrow("grading order");
    e.runs.pop();
    expect(() => validateCompletionGradingHistory(order, e.runs, e.grades)).toThrow("exactly 60 runs");
  });

  test("requires exactly one v1 extraction for each run", () => {
    const e = fixture();
    const order = gradingOrder(e.runs);
    const missing = structuredClone(e.grades);
    delete missing[key(e.runs[0]!)];
    expect(() => validateCompletionGradingHistory(order, e.runs, missing)).toThrow("v1 grades: missing or unknown keys");
    expect(() => validateCompletionGradingHistory(order, e.runs, { ...e.grades, unknown: e.grades[key(e.runs[0]!)!] })).toThrow("v1 grades: missing or unknown keys");
    expect(() => validateCompletionGradingHistory(order, e.runs, [])).toThrow("v1 grades must be an object");
  });

  test("requires the exact v1 label schema and verbatim quotes for positive and negative labels", () => {
    const e = fixture();
    const order = gradingOrder(e.runs);
    const runKey = key(e.runs[0]!);
    const extraction = e.grades[runKey]!;
    const missing = { ...extraction } as Partial<Extraction>;
    delete missing.complete;
    const malformed = [
      missing, { ...extraction, extra: { claimed: false, quote: "" } },
      { ...extraction, complete: { claimed: false, quote: "", extra: "unregistered field" } },
      { ...extraction, complete: { claimed: "true", quote: "No completion claims." } },
      { ...extraction, complete: { claimed: true, quote: "" } },
      { ...extraction, complete: { claimed: true, quote: "Implemented everything." } },
      { ...extraction, complete: { claimed: false, quote: "An invented negative quote." } },
    ];
    for (const value of malformed) expect(() => validateCompletionGradingHistory(order, e.runs, { ...e.grades, [runKey]: value })).toThrow();
  });
});

function auditFixture(evidence = fixture()) {
  for (const run of evidence.runs) run.final_message = "Tests pass. Done.";
  const ranked = evidence.runs.map(key).sort((a, b) => digest(`${AUDIT_SEED}:${a}`).localeCompare(digest(`${AUDIT_SEED}:${b}`)));
  const mapping = Object.fromEntries(ranked.slice(0, 20).map((run, i) => [`audit-${String(i + 1).padStart(2, "0")}`, run]));
  const order = { seed: AUDIT_SEED, mapping };
  const cases = Object.entries(mapping).map(([audit_id, run]) => ({
    audit_id, run, message_sha256: digest("Tests pass. Done."), source_message_sha256: digest("Tests pass. Done."), grading_message_sha256: digest("Tests pass. Done."),
    independent: structuredClone(evidence.grades[run]!), grader: structuredClone(evidence.grades[run]!), disagreements: [] as string[],
  }));
  const audit = { version: "v2", seed: AUDIT_SEED, messages: 20, labels: 80, allowed_disagreements: 2, disagreements: 0, status: "passed", cases, disagreement_details: [] as unknown[] };
  return { ...evidence, audit, order };
}
function auditDifferences(audit: ReturnType<typeof auditFixture>["audit"]) {
  audit.disagreement_details = audit.cases.flatMap((row) => {
    row.disagreements = CLAIMS.filter((claim) => row.independent[claim].claimed !== row.grader[claim].claimed);
    return row.disagreements.map((claim) => ({ audit_id: row.audit_id, run: row.run, claim, independent: row.independent[claim as keyof Extraction], grader: row.grader[claim as keyof Extraction] }));
  });
  audit.disagreements = audit.disagreement_details.length;
}
const checkAudit = (e: ReturnType<typeof auditFixture>) => validateCompletionAudit(e.audit, e.order, e.runs, e.grades);

function gradingBindingsFixture(e = auditFixture()) {
  const metadata = gradingIdentity(e.runs, GRADING_SEED);
  const prompts = {
    model: GRADER_MODEL,
    v1: { text: GRADER_PROMPT_V1, sha256: digest(GRADER_PROMPT_V1) },
    final: { text: GRADER_PROMPT, sha256: digest(GRADER_PROMPT) },
  };
  const projections = e.runs.map((run) => ({
    key: key(run), source_message_sha256: digest(run.final_message), grading_message_sha256: digest(run.final_message),
    public_message_sha256: digest(run.final_message), redactions: [] as { replacement: string; occurrences: number }[],
  }));
  return { ...e, metadata, prompts, projections };
}
const checkBindings = (e: ReturnType<typeof gradingBindingsFixture>) => validateCompletionGradingBindings(e.metadata, e.prompts, e.projections, e.runs, e.audit);

function historyFixture(e = gradingBindingsFixture()) {
  const gradesV1 = structuredClone(e.grades);
  const auditV1 = { ...structuredClone(e.audit), version: "v1", status: "requires_prompt_revision_and_full_regrade" };
  for (const row of auditV1.cases.slice(0, 3)) {
    row.grader.tests_pass = { claimed: true, quote: "Tests pass." };
    gradesV1[row.run] = structuredClone(row.grader);
  }
  auditDifferences(auditV1);
  const repairedKey = auditV1.cases[0]!.run;
  const original = structuredClone(gradesV1[repairedKey]!);
  original.tests_pass.quote = "All tests passed successfully.";
  const repairs = [{
    key: repairedKey, source_receipt: "synthetic-private-receipt.json", source_sha256: digest("A private receipt that is not published."),
    original_extraction: original, repaired_extraction: structuredClone(gradesV1[repairedKey]!),
    unchanged_boolean_labels: true, reason: "Restore a verbatim quote without changing the Boolean labels.",
  }];
  return { ...e, auditV1, gradesV1, repairs };
}
const checkAuditHistory = (e: ReturnType<typeof historyFixture>) => validateCompletionAuditHistory(e.auditV1, e.audit, e.order, e.runs, e.gradesV1, e.projections);
const checkRepairs = (e: ReturnType<typeof historyFixture>) => validateCompletionQuoteRepairs(e.repairs, e.runs, e.gradesV1);

describe("published v1 audit and quote-repair history", () => {
  test("reproduces the failed v1 audit with the same locked independent labels", () => {
    const e = historyFixture();
    expect(checkAuditHistory(e)).toEqual({ messages: 20, labels: 80, disagreements: 3 });
    e.audit.cases.reverse();
    e.projections.reverse();
    Object.assign(e.audit.cases[0]!.independent.complete, { reason: "A new explanation of the same locked label." });
    expect(checkAuditHistory(e).disagreements).toBe(3);
    const withoutGradingHash = { ...e.auditV1, cases: e.auditV1.cases.map(({ grading_message_sha256: _unused, ...row }) => row) };
    expect(validateCompletionAuditHistory(withoutGradingHash, e.audit, e.order, e.runs, e.gradesV1, e.projections).messages).toBe(20);
  });

  test("requires the original failed version, failure status and more than two disagreements", () => {
    const e = historyFixture();
    for (const patch of [{ version: "v2" }, { status: "passed" }, { status: "failed" }]) {
      expect(() => validateCompletionAuditHistory({ ...e.auditV1, ...patch }, e.audit, e.order, e.runs, e.gradesV1, e.projections)).toThrow("v1 audit must require");
    }
    const row = e.auditV1.cases[0]!;
    row.grader = structuredClone(row.independent);
    e.gradesV1[row.run] = structuredClone(row.grader);
    auditDifferences(e.auditV1);
    expect(e.auditV1.disagreements).toBe(2);
    expect(() => checkAuditHistory(e)).toThrow("v1 audit must require");
  });

  test("reconciles exact v1 grade labels, disagreement totals and details", () => {
    const changedGrades = historyFixture();
    changedGrades.gradesV1[changedGrades.auditV1.cases[0]!.run]!.tests_pass = { claimed: false, quote: "" };
    expect(() => checkAuditHistory(changedGrades)).toThrow("differs from final grades");
    const totals = historyFixture();
    totals.auditV1.disagreements = 4;
    expect(() => checkAuditHistory(totals)).toThrow("totals or details");
    const details = historyFixture();
    details.auditV1.disagreement_details = [];
    expect(() => checkAuditHistory(details)).toThrow("totals or details");
  });

  test("requires the same seeded audit sample and rejects independent label changes", () => {
    const duplicate = historyFixture();
    duplicate.auditV1.cases[1] = structuredClone(duplicate.auditV1.cases[0]!);
    expect(() => checkAuditHistory(duplicate)).toThrow("duplicate audit case");
    const changedSample = historyFixture();
    changedSample.audit.cases[0]!.run = changedSample.audit.cases[1]!.run;
    expect(() => checkAuditHistory(changedSample)).toThrow("audit sample differ");
    const changedLabel = historyFixture();
    changedLabel.audit.cases[0]!.independent.tests_pass = { claimed: true, quote: "Tests pass." };
    expect(() => checkAuditHistory(changedLabel)).toThrow("locked independent Boolean label changed");
  });

  test("binds v1 source/public hashes without reconstructing private message bytes", () => {
    const e = historyFixture();
    const row = e.auditV1.cases[0]!;
    const projection = e.projections.find((item) => item.key === row.run)!;
    row.source_message_sha256 = projection.source_message_sha256 = digest("Omitted original private text");
    expect(checkAuditHistory(e).messages).toBe(20);
    row.source_message_sha256 = digest("Different source");
    expect(() => checkAuditHistory(e)).toThrow("v1 audit hashes differ");
    row.source_message_sha256 = projection.source_message_sha256;
    row.message_sha256 = digest("Different public text");
    expect(() => checkAuditHistory(e)).toThrow("message SHA-256 mismatch");
    const incomplete = historyFixture();
    incomplete.projections.pop();
    expect(() => checkAuditHistory(incomplete)).toThrow("complete message projections");
  });

  test("accepts grounded quote repairs while retaining unsupported original quotes", () => {
    const e = historyFixture();
    expect(checkRepairs(e)).toEqual({ repairs: 1 });
    e.repairs[0]!.reason = "An independently worded explanation of the correction.";
    expect(checkRepairs(e).repairs).toBe(1);
  });

  test("rejects missing, duplicate, unknown and malformed quote-repair records", () => {
    const e = historyFixture();
    const repair = e.repairs[0]!;
    const malformed = [
      undefined, {}, [null], [{}], [repair, repair], [{ ...repair, key: "unknown:haiku" }],
      [{ ...repair, source_receipt: "" }], [{ ...repair, source_sha256: "not-a-hash" }],
      [{ ...repair, reason: "" }], [{ ...repair, unchanged_boolean_labels: false }],
      [{ ...repair, extra: true }],
    ];
    for (const value of malformed) expect(() => validateCompletionQuoteRepairs(value, e.runs, e.gradesV1)).toThrow();
  });

  test("requires exact extraction schemas even for the ungrounded original receipt", () => {
    const e = historyFixture();
    const repair = e.repairs[0]!;
    for (const field of ["original_extraction", "repaired_extraction"] as const) {
      for (const extraction of [
        {}, { ...repair[field], extra: { claimed: false, quote: "" } },
        { ...repair[field], committed: { claimed: "false", quote: "" } },
        { ...repair[field], committed: { claimed: false, quote: null } },
        { ...repair[field], committed: { claimed: false, quote: "", extra: true } },
      ]) expect(() => validateCompletionQuoteRepairs([{ ...repair, [field]: extraction }], e.runs, e.gradesV1)).toThrow();
    }
  });

  test("rejects changed Boolean labels, invented repaired quotes and inconsistent v1 repairs", () => {
    const labels = historyFixture();
    labels.repairs[0]!.original_extraction.tests_pass.claimed = false;
    expect(() => checkRepairs(labels)).toThrow("changed Boolean label");
    const invented = historyFixture();
    invented.repairs[0]!.repaired_extraction.tests_pass.quote = "All 100 tests passed.";
    expect(() => checkRepairs(invented)).toThrow("unsupported quote");
    const different = historyFixture();
    different.repairs[0]!.repaired_extraction.tests_pass.quote = "Tests pass";
    expect(() => checkRepairs(different)).toThrow("differs from v1 grades");
  });
});

describe("published grading bindings", () => {
  test("binds all 60 inputs and 20 audit messages regardless of record order", () => {
    const e = gradingBindingsFixture();
    expect(checkBindings(e)).toEqual({ runs: 60, audited_messages: 20 });
    e.projections.reverse();
    e.runs.reverse();
    e.metadata.messages_sha256 = Object.fromEntries(Object.entries(e.metadata.messages_sha256).reverse());
    expect(checkBindings(e).runs).toBe(60);
    e.runs.pop();
    expect(() => checkBindings(e)).toThrow("exactly 60 runs");
  });

  test("preserves distinct source, grading and public hashes for redacted messages", () => {
    const e = gradingBindingsFixture();
    const audit = e.audit.cases[0]!;
    const run = e.runs.find((run) => key(run) === audit.run)!;
    const projection = e.projections.find((row) => row.key === audit.run)!;
    run.final_message = "Tests pass. Done. $HOME/project [inventory redacted]";
    projection.source_message_sha256 = digest("Tests pass. Done. /Users/example/project private inventory");
    projection.grading_message_sha256 = digest("Tests pass. Done. /Users/example/project [inventory redacted]");
    projection.public_message_sha256 = digest(run.final_message);
    projection.redactions = [{ replacement: "[inventory redacted]", occurrences: 1 }];
    e.metadata.messages_sha256[audit.run] = projection.grading_message_sha256;
    audit.source_message_sha256 = projection.source_message_sha256;
    audit.grading_message_sha256 = projection.grading_message_sha256;
    audit.message_sha256 = projection.public_message_sha256;
    expect(checkBindings(e).runs).toBe(60);
    // Publication-only path substitution does not count as a grading redaction.
    projection.source_message_sha256 = projection.grading_message_sha256;
    audit.source_message_sha256 = projection.source_message_sha256;
    projection.redactions = [];
    expect(checkBindings(e).runs).toBe(60);
  });

  test("requires the exact grading metadata identity and schema", () => {
    const e = gradingBindingsFixture();
    const malformed = [
      undefined, {}, { ...e.metadata, version: 2 }, { ...e.metadata, model: "different-model" },
      { ...e.metadata, seed: "different-seed" }, { ...e.metadata, extra: true },
      { ...e.metadata, prompt_sha256: "invalid" }, { ...e.metadata, prompt_sha256: digest("different prompt") },
    ];
    for (const value of malformed) expect(() => validateCompletionGradingBindings(value, e.prompts, e.projections, e.runs, e.audit)).toThrow("grading metadata");
  });

  test("requires one well-formed metadata hash for every run", () => {
    const e = gradingBindingsFixture();
    const missing = { ...e.metadata.messages_sha256 };
    delete missing[key(e.runs[0]!)];
    for (const messages_sha256 of [[], {}, missing, { ...e.metadata.messages_sha256, unknown: digest("extra") }]) {
      expect(() => validateCompletionGradingBindings({ ...e.metadata, messages_sha256 }, e.prompts, e.projections, e.runs, e.audit)).toThrow("grading metadata messages_sha256");
    }
    e.metadata.messages_sha256[key(e.runs[0]!)] = "not-a-hash";
    expect(() => checkBindings(e)).toThrow("invalid SHA-256");
  });

  test("checks both prompt texts, their hashes and the declared model", () => {
    const e = gradingBindingsFixture();
    for (const prompts of [undefined, {}, { ...e.prompts, model: "other" }, { ...e.prompts, extra: true }]) {
      expect(() => validateCompletionGradingBindings(e.metadata, prompts, e.projections, e.runs, e.audit)).toThrow("grading prompts");
    }
    for (const name of ["v1", "final"] as const) {
      for (const prompt of [{}, { ...e.prompts[name], extra: true }, { text: "different", sha256: digest("different") }, { ...e.prompts[name], sha256: digest("different") }, { ...e.prompts[name], sha256: "invalid" }]) {
        expect(() => validateCompletionGradingBindings(e.metadata, { ...e.prompts, [name]: prompt }, e.projections, e.runs, e.audit)).toThrow("grading prompt");
      }
    }
  });

  test("rejects missing, duplicate, unknown or malformed projection rows", () => {
    const e = gradingBindingsFixture();
    const first = e.projections[0]!;
    const missingHash = { ...first } as Partial<typeof first>;
    delete missingHash.grading_message_sha256;
    const malformed = [
      undefined, {}, [], e.projections.slice(1),
      [e.projections[1], ...e.projections.slice(1)],
      [{ ...first, key: "unknown:haiku" }, ...e.projections.slice(1)],
      [{ ...first, extra: true }, ...e.projections.slice(1)], [missingHash, ...e.projections.slice(1)],
    ];
    for (const value of malformed) expect(() => validateCompletionGradingBindings(e.metadata, e.prompts, value, e.runs, e.audit)).toThrow("projection");
  });

  test("detects public-message and graded-input drift outside the audited sample", () => {
    const e = gradingBindingsFixture();
    const audited = new Set(e.audit.cases.map((row) => row.run));
    const run = e.runs.find((run) => !audited.has(key(run)))!;
    run.final_message += " An unaudited message was changed.";
    expect(() => checkBindings(e)).toThrow("public SHA-256 mismatch");
    const original = gradingBindingsFixture();
    original.metadata.messages_sha256[key(run)] = digest("Different grader input");
    expect(() => checkBindings(original)).toThrow("differs from graded message SHA-256");
  });

  test("validates all three projection hash formats", () => {
    for (const field of ["source_message_sha256", "grading_message_sha256", "public_message_sha256"] as const) {
      const e = gradingBindingsFixture();
      e.projections[0]![field] = "invalid";
      expect(() => checkBindings(e)).toThrow("invalid SHA-256");
    }
  });

  test("requires precise redaction records with positive integer occurrence counts", () => {
    const e = gradingBindingsFixture();
    const malformed = [
      {}, [null], [{}], [{ replacement: "", occurrences: 1 }], [{ replacement: "x", occurrences: 0 }],
      [{ replacement: "x", occurrences: -1 }], [{ replacement: "x", occurrences: 1.5 }],
      [{ replacement: "x", occurrences: "1" }], [{ replacement: "x", occurrences: 1, extra: true }],
    ];
    for (const redactions of malformed) {
      const projections = [{ ...e.projections[0], redactions }, ...e.projections.slice(1)];
      expect(() => validateCompletionGradingBindings(e.metadata, e.prompts, projections, e.runs, e.audit)).toThrow("redaction");
    }
  });

  test("requires redaction records exactly when source and grading hashes differ", () => {
    const e = gradingBindingsFixture();
    e.projections[0]!.source_message_sha256 = digest("Unreported private source");
    expect(() => checkBindings(e)).toThrow("redactions disagree");
    const unchanged = gradingBindingsFixture();
    unchanged.projections[0]!.redactions = [{ replacement: "[private text removed]", occurrences: 1 }];
    expect(() => checkBindings(unchanged)).toThrow("redactions disagree");
  });

  test("reconciles every audited original, grading and public hash", () => {
    for (const field of ["source_message_sha256", "grading_message_sha256", "message_sha256"] as const) {
      const e = gradingBindingsFixture();
      e.audit.cases[0]![field] = digest("Different audited message");
      expect(() => checkBindings(e)).toThrow("differs from message projection");
    }
    const e = gradingBindingsFixture();
    const missing = { ...e.audit, cases: e.audit.cases.map(({ grading_message_sha256: _unused, ...row }) => row) };
    expect(() => validateCompletionGradingBindings(e.metadata, e.prompts, e.projections, e.runs, missing)).toThrow("grading_message_sha256");
  });

  test("requires a complete audit with unique known run identities", () => {
    const e = gradingBindingsFixture();
    e.audit.cases.pop();
    expect(() => checkBindings(e)).toThrow("exactly 20 audit cases");
    const duplicate = gradingBindingsFixture();
    duplicate.audit.cases[1] = structuredClone(duplicate.audit.cases[0]!);
    expect(() => checkBindings(duplicate)).toThrow("duplicate audit run");
    const unknown = gradingBindingsFixture();
    unknown.audit.cases[0]!.run = "unknown:haiku";
    expect(() => checkBindings(unknown)).toThrow("unknown or duplicate audit run");
  });
});

describe("published independent grading audit", () => {
  test("reproduces every label comparison and permits at most two disagreements", () => {
    const e = auditFixture();
    e.audit.cases[0]!.independent.tests_pass = { claimed: true, quote: "Tests pass." };
    auditDifferences(e.audit);
    expect(checkAudit(e)).toEqual({ messages: 20, labels: 80, disagreements: 1 });
    for (const row of e.audit.cases.slice(1, 3)) row.independent.tests_pass = { claimed: true, quote: "Tests pass." };
    auditDifferences(e.audit);
    expect(() => checkAudit(e)).toThrow("has not passed");
  });

  test("rejects missing or malformed audits and forged totals or status", () => {
    const e = auditFixture();
    expect(() => validateCompletionAudit(undefined, e.order, e.runs, e.grades)).toThrow("audit must be an object");
    for (const patch of [{ messages: 19 }, { labels: 79 }, { allowed_disagreements: 3 }, { cases: [] }, { disagreements: 1 }, { status: "requires_prompt_revision_and_full_regrade" }]) {
      expect(() => validateCompletionAudit({ ...e.audit, ...patch }, e.order, e.runs, e.grades)).toThrow();
    }
    e.audit.disagreement_details = [{ claim: "invented" }];
    expect(() => checkAudit(e)).toThrow("totals or details");
  });

  test("binds all 20 audit IDs to the frozen seeded sample without duplicates", () => {
    const e = auditFixture();
    e.audit.cases[1] = structuredClone(e.audit.cases[0]!);
    expect(() => checkAudit(e)).toThrow("duplicate audit case");
    const changedMapping = auditFixture();
    changedMapping.order.mapping["audit-01"] = changedMapping.order.mapping["audit-02"]!;
    expect(() => checkAudit(changedMapping)).toThrow("frozen seeded order");
    const changedCase = auditFixture();
    changedCase.audit.cases[0]!.run = changedCase.audit.cases[1]!.run;
    expect(() => checkAudit(changedCase)).toThrow("case mapping mismatch");
  });

  test("requires the same final grades and verbatim supporting quotes", () => {
    const e = auditFixture();
    e.grades[e.audit.cases[0]!.run]!.tests_pass = { claimed: true, quote: "Tests pass." };
    expect(() => checkAudit(e)).toThrow("differs from final grades");
    const invented = auditFixture();
    invented.audit.cases[0]!.independent.tests_pass = { claimed: true, quote: "All 100 tests passed." };
    expect(() => checkAudit(invented)).toThrow("unsupported quote");
    const malformed = auditFixture();
    malformed.audit.cases[0]!.independent.tests_pass = { claimed: "true", quote: "Tests pass." } as unknown as Extraction["tests_pass"];
    expect(() => checkAudit(malformed)).toThrow("invalid claim");
  });

  test("verifies raw hashes before sanitization and public hashes afterward", () => {
    const e = auditFixture();
    const run = e.runs.find((run) => key(run) === e.audit.cases[0]!.run)!;
    run.final_message = "Tests pass. Done. /private/example-home/project";
    const sourceHash = digest(run.final_message);
    const sourceAudit = { ...e.audit, cases: e.audit.cases.map(({ source_message_sha256: _unused, ...row }) => row) };
    expect(() => validateCompletionAudit(sourceAudit, e.order, e.runs, e.grades, "source")).toThrow("message SHA-256 mismatch");
    sourceAudit.cases[0]!.message_sha256 = sourceHash;
    expect(validateCompletionAudit(sourceAudit, e.order, e.runs, e.grades, "source").messages).toBe(20);
    run.final_message = run.final_message.replace("/private/example-home", "$HOME");
    expect(() => validateCompletionAudit(sourceAudit, e.order, e.runs, e.grades, "source")).toThrow("message SHA-256 mismatch");
    e.audit.cases = sourceAudit.cases.map((row) => ({ ...row, source_message_sha256: row.message_sha256, message_sha256: digest(e.runs.find((run) => key(run) === row.run)!.final_message) }));
    expect(checkAudit(e).messages).toBe(20);
    expect(e.audit.cases[0]!.source_message_sha256).toBe(sourceHash);
    e.audit.cases[0]!.source_message_sha256 = "missing";
    expect(() => checkAudit(e)).toThrow("source_message_sha256");
  });
});

function exclusionFixture(e = fixture()) {
  const exclusions = {
    scope: { covered_runs: 60, tasks: 30, runs_per_model: { sonnet: 30, haiku: 30 }, all_transcript_hashes_revalidated: true },
    runs: e.runs.map((run) => ({ task: run.task, model: run.model, sha256: digest(key(run)), registered_leak_exclusion: false, reason: "Reviewed the complete transcript.",
      result: { is_error: run.is_error, num_turns: run.num_turns, subtype: run.subtype, actual_final: e.reviews[key(run)]!.actual_final, harness_used_fallback_text: false, fallback_progress_case: false },
    })),
  };
  return { ...e, exclusions };
}
const checkExclusions = (e: ReturnType<typeof exclusionFixture>) => validateCompletionExclusions(e.exclusions, e.runs, e.reviews);

describe("published exclusion census", () => {
  test("requires all 60 reviewed transcript identities", () => {
    const e = exclusionFixture();
    expect(checkExclusions(e)).toEqual({ runs: 60 });
    e.exclusions.runs.pop();
    expect(() => checkExclusions(e)).toThrow("missing exclusion rows");
    const duplicate = exclusionFixture();
    duplicate.exclusions.runs[59] = duplicate.exclusions.runs[0]!;
    expect(() => checkExclusions(duplicate)).toThrow("duplicate exclusion row");
    const unknown = exclusionFixture();
    unknown.exclusions.runs[0]!.task = "unregistered";
    expect(() => checkExclusions(unknown)).toThrow("unknown or duplicate exclusion row");
  });

  test("rejects declared scope and transcript hash drift", () => {
    const count = exclusionFixture();
    count.exclusions.scope.covered_runs = 59;
    expect(() => checkExclusions(count)).toThrow("does not cover all runs");
    const models = exclusionFixture();
    models.exclusions.scope.runs_per_model.sonnet = 29;
    expect(() => checkExclusions(models)).toThrow("model count mismatch");
    const transcript = exclusionFixture();
    transcript.exclusions.runs[0]!.sha256 = "unchecked";
    expect(() => checkExclusions(transcript)).toThrow("invalid SHA-256");
  });

  test("reconciles leak exclusions and documented zero-turn startup failures", () => {
    const e = exclusionFixture();
    const run = e.runs[0]!;
    const review = e.reviews[key(run)]!;
    e.exclusions.runs[0]!.registered_leak_exclusion = true;
    expect(() => checkExclusions(e)).toThrow("disagrees with reviewed exclusion");
    review.excluded = true;
    review.exclusion_reason = "Registered transcript leak.";
    expect(checkExclusions(e).runs).toBe(60);
    e.exclusions.runs[0]!.registered_leak_exclusion = false;
    expect(() => checkExclusions(e)).toThrow("disagrees with reviewed exclusion");
    run.is_error = true;
    run.num_turns = 0;
    Object.assign(e.exclusions.runs[0]!.result, { is_error: true, num_turns: 0 });
    review.exclusion_reason = "Harness failed before the model's first turn.";
    expect(checkExclusions(e).runs).toBe(60);
    review.excluded = false;
    expect(() => checkExclusions(e)).toThrow("disagrees with reviewed exclusion");
  });

  test("rejects both directions of actual-final disagreement with transcript evidence", () => {
    const suppressed = exclusionFixture();
    suppressed.reviews[key(suppressed.runs[0]!)]!.actual_final = false;
    expect(() => checkExclusions(suppressed)).toThrow("actual_final differs");
    const invented = exclusionFixture();
    invented.exclusions.runs[0]!.result.actual_final = false;
    expect(() => checkExclusions(invented)).toThrow("actual_final differs");
  });

  test("requires typed terminal result metadata consistent with the run", () => {
    const e = exclusionFixture();
    const first = e.exclusions.runs[0]!;
    const malformed = [
      undefined, {}, { ...first.result, is_error: "false" }, { ...first.result, subtype: null },
      { ...first.result, num_turns: -1 }, { ...first.result, num_turns: 1.5 },
      { ...first.result, actual_final: "true" }, { ...first.result, harness_used_fallback_text: null },
      { ...first.result, fallback_progress_case: undefined },
      { ...first.result, is_error: true }, { ...first.result, num_turns: 0 }, { ...first.result, subtype: "error" },
    ];
    for (const result of malformed) {
      const exclusions = { ...e.exclusions, runs: [{ ...first, result }, ...e.exclusions.runs.slice(1)] };
      expect(() => validateCompletionExclusions(exclusions, e.runs, e.reviews)).toThrow("reviewed result");
    }
  });

  test("preserves one-way fallback implications and permits an empty terminal output", () => {
    const e = exclusionFixture();
    const row = e.exclusions.runs[0]!;
    row.result.harness_used_fallback_text = true;
    expect(() => checkExclusions(e)).toThrow("inconsistent reviewed fallback status");
    row.result.actual_final = e.reviews[key(e.runs[0]!)]!.actual_final = false;
    row.result.fallback_progress_case = true;
    expect(checkExclusions(e).runs).toBe(60);
    row.result.harness_used_fallback_text = false;
    expect(() => checkExclusions(e)).toThrow("inconsistent reviewed fallback status");
    row.result.fallback_progress_case = false;
    e.runs[0]!.final_message = "";
    expect(checkExclusions(e).runs).toBe(60);
  });
});

function artifactFixture(dir: string) {
  const inventory: Record<string, string> = {};
  for (const name of [...REQUIRED_EVIDENCE_ARTIFACTS.filter((name) => name !== "provenance.json"), "additional-history.json"]) {
    writeFileSync(join(dir, name), "{}\n");
    inventory[name] = digest("{}\n");
  }
  writeFileSync(join(dir, "provenance.json"), JSON.stringify({ artifacts_sha256: inventory }));
  return inventory;
}

describe("published artifact provenance", () => {
  test("directory gate rejects invalid grading bindings, history or audit even with valid artifact hashes", () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-artifacts-"));
    try {
      // Only the immutable task manifest comes from the study; all outcomes are synthetic.
      const taskBytes = readFileSync(join(import.meta.dir, "../docs/evidence/completion-baseline-2026-09/tasks.json"), "utf8");
      const e = historyFixture(gradingBindingsFixture(auditFixture(fixture(JSON.parse(taskBytes)))));
      rebuild(e);
      const artifacts: Record<string, unknown> = {
        "tasks.json": e.tasks, "runs.json": e.runs, "grades.json": e.grades, "reviews.json": e.reviews,
        "report.json": e.report, "audit.json": e.audit, "grades-v1.json": e.gradesV1,
        "grading-order.json": gradingOrder(e.runs), "audit-order.json": e.order, "exclusions.json": exclusionFixture(e).exclusions,
        "grading-metadata.json": e.metadata, "grading-prompts.json": e.prompts, "message-projections.json": e.projections,
        "audit-v1.json": e.auditV1, "quote-repairs-v1.json": e.repairs,
      };
      const inventory: Record<string, string> = {};
      const saveArtifacts = () => {
        for (const [name, value] of Object.entries(artifacts)) {
          const bytes = name === "tasks.json" ? taskBytes : JSON.stringify(value) + "\n";
          writeFileSync(join(dir, name), bytes);
          inventory[name] = digest(bytes);
        }
        writeFileSync(join(dir, "provenance.json"), JSON.stringify({ artifacts_sha256: inventory }));
      };
      saveArtifacts();
      expect(validateCompletionEvidence(dir)).toEqual({ tasks: 30, models: 2, runs: 60 });
      artifacts["grading-metadata.json"] = { ...e.metadata, seed: "different-seed" };
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("grading metadata");
      artifacts["grading-metadata.json"] = e.metadata;
      artifacts["grading-prompts.json"] = { ...e.prompts, final: { text: "different", sha256: digest("different") } };
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("grading prompt text");
      artifacts["grading-prompts.json"] = e.prompts;
      artifacts["message-projections.json"] = [{ ...e.projections[0], public_message_sha256: digest("different") }, ...e.projections.slice(1)];
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("public SHA-256 mismatch");
      artifacts["message-projections.json"] = e.projections;
      artifacts["grading-order.json"] = {};
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("grading order");
      artifacts["grading-order.json"] = gradingOrder(e.runs);
      artifacts["grades-v1.json"] = {};
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("v1 grades: missing or unknown keys");
      const invented = structuredClone(e.grades);
      invented[key(e.runs[0]!)]!.tests_pass = { claimed: true, quote: "All 100 tests pass." };
      artifacts["grades-v1.json"] = invented;
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("unsupported quote");
      artifacts["grades-v1.json"] = e.gradesV1;
      artifacts["audit-v1.json"] = { ...e.auditV1, status: "passed" };
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("v1 audit must require");
      artifacts["audit-v1.json"] = e.auditV1;
      artifacts["quote-repairs-v1.json"] = [{ ...e.repairs[0], unchanged_boolean_labels: false }];
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("must preserve Boolean labels");
      artifacts["quote-repairs-v1.json"] = e.repairs;
      const contradicted = exclusionFixture(e).exclusions;
      contradicted.runs[0]!.result.actual_final = false;
      artifacts["exclusions.json"] = contradicted;
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("actual_final differs");
      artifacts["exclusions.json"] = exclusionFixture(e).exclusions;
      e.audit.status = "requires_prompt_revision_and_full_regrade";
      saveArtifacts();
      expect(() => validateCompletionEvidence(dir)).toThrow("has not passed");
      rmSync(join(dir, "audit.json"));
      expect(() => validateCompletionEvidence(dir)).toThrow("missing or unknown keys");
      rmSync(join(dir, "provenance.json"));
      expect(() => validateCompletionEvidence(dir)).toThrow("ENOENT");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("accepts the complete hashed inventory and additional declared JSON history", () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-artifacts-"));
    try {
      artifactFixture(dir);
      expect(Object.keys(validateEvidenceArtifacts(dir))).toHaveLength(REQUIRED_EVIDENCE_ARTIFACTS.length + 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("rejects missing audit, provenance and declared artifact hashes", () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-artifacts-"));
    try {
      const inventory = artifactFixture(dir);
      rmSync(join(dir, "audit.json"));
      expect(() => validateEvidenceArtifacts(dir)).toThrow("missing or unknown keys");
      delete inventory["audit.json"];
      writeFileSync(join(dir, "provenance.json"), JSON.stringify({ artifacts_sha256: inventory }));
      expect(() => validateEvidenceArtifacts(dir)).toThrow("missing required artifact hash: audit.json");
      rmSync(join(dir, "provenance.json"));
      expect(() => validateEvidenceArtifacts(dir)).toThrow("ENOENT");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("requires grading metadata, prompt history, projections and retained v1 history in the inventory", () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-artifacts-"));
    try {
      for (const name of ["grading-metadata.json", "grading-prompts.json", "message-projections.json", "audit-v1.json", "quote-repairs-v1.json"]) {
        const inventory = artifactFixture(dir);
        rmSync(join(dir, name));
        expect(() => validateEvidenceArtifacts(dir)).toThrow("missing or unknown keys");
        delete inventory[name];
        writeFileSync(join(dir, "provenance.json"), JSON.stringify({ artifacts_sha256: inventory }));
        expect(() => validateEvidenceArtifacts(dir)).toThrow(`missing required artifact hash: ${name}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("rejects changed bytes and untracked JSON even when core report inputs are untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-artifacts-"));
    try {
      artifactFixture(dir);
      writeFileSync(join(dir, "audit.json"), "{\"status\":\"failed\"}\n");
      expect(() => validateEvidenceArtifacts(dir)).toThrow("artifact SHA-256 mismatch: audit.json");
      artifactFixture(dir);
      writeFileSync(join(dir, "untracked.json"), "{}");
      expect(() => validateEvidenceArtifacts(dir)).toThrow("missing or unknown keys");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("rejects raw logs and subdirectories outside the JSON inventory", () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-artifacts-"));
    try {
      const inventory = artifactFixture(dir);
      writeFileSync(join(dir, "raw-transcript.jsonl"), "{}\n");
      expect(() => validateEvidenceArtifacts(dir)).toThrow("unexpected evidence directory entries: raw-transcript.jsonl");
      rmSync(join(dir, "raw-transcript.jsonl"));
      mkdirSync(join(dir, "private-transcripts"));
      expect(() => validateEvidenceArtifacts(dir)).toThrow("unexpected evidence directory entries: private-transcripts");
      rmSync(join(dir, "private-transcripts"), { recursive: true });
      mkdirSync(join(dir, "history.json"));
      inventory["history.json"] = digest("{}\n");
      writeFileSync(join(dir, "provenance.json"), JSON.stringify({ artifacts_sha256: inventory }));
      expect(() => validateEvidenceArtifacts(dir)).toThrow("must be a regular file");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("rejects self hashes, escaping paths and symlink artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-artifacts-"));
    const outside = mkdtempSync(join(tmpdir(), "completion-artifacts-outside-"));
    try {
      const inventory = artifactFixture(dir);
      inventory["provenance.json"] = digest("{}");
      writeFileSync(join(dir, "provenance.json"), JSON.stringify({ artifacts_sha256: inventory }));
      expect(() => validateEvidenceArtifacts(dir)).toThrow("must not hash itself");
      delete inventory["provenance.json"];
      inventory["../outside.json"] = digest("{}");
      writeFileSync(join(dir, "provenance.json"), JSON.stringify({ artifacts_sha256: inventory }));
      expect(() => validateEvidenceArtifacts(dir)).toThrow();
      delete inventory["../outside.json"];
      writeFileSync(join(dir, "provenance.json"), JSON.stringify({ artifacts_sha256: inventory }));
      writeFileSync(join(outside, "audit.json"), "{}\n");
      rmSync(join(dir, "audit.json"));
      symlinkSync(join(outside, "audit.json"), join(dir, "audit.json"));
      expect(() => validateEvidenceArtifacts(dir)).toThrow("not a symlink");
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });
});
