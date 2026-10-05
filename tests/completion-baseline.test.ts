// Keep all completion-study validation in the existing required tests/ gate.
import "../bench/completion.test.ts";
import "../bench/completion-report.test.ts";
import "../bench/completion-evidence.test.ts";
import { test } from "bun:test";
import { fileURLToPath } from "node:url";
import { validateCompletionEvidence } from "../bench/completion-evidence.ts";

test("committed completion-baseline evidence reproduces the full frozen study", () => {
  validateCompletionEvidence(fileURLToPath(new URL("../docs/evidence/completion-baseline-2026-09", import.meta.url)));
});
