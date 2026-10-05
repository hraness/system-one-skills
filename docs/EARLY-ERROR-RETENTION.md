# Early-error retention and evidence versions

Version 0.4.1 retains a small amount of early failure evidence independently of
the 256 KiB suffix. When a failed check prints its error and then a large amount
of output, the error can still appear in the compact result. The complete
private log remains authoritative.

The sampler keeps at most 2 KiB across 12 diagnostic/context lines, plus a
bounded unfinished-line prefix. It records original byte offsets and combines
overlapping ranges once. The reducer first selects the same suffix diagnostics
and tail as v0.4, then adds the early sample. Early errors therefore cannot
displace that existing evidence. The combined excerpt retains at most 6 KiB of
source bytes; headers and omission notices add presentation overhead. It does
not run a model or execute the command again.
Successful commands still use the existing result-selection behavior. Short
binary output passes through exactly; long binary excerpts are decoded text,
with `text_lossy=true` when selected bytes require replacement during decoding.
Log files preserve original bytes. Interleaved partial stdout/stderr lines
can defeat the heuristic matcher. This feature does not promise a complete
diagnosis or eliminate the need to inspect the full log.

## Why the evidence gate changed

The v0.4 calibration and holdout reports pin their evaluated runtime files.
Comparing those hashes with a changed implementation correctly reports that the
old evidence does not qualify the new implementation. It does not mean the old
findings should be deleted or their hashes silently replaced.

The historical gate now stages the exact public v0.4 source/report closure from
commit `49c9ba49212f465c6a7d6054208bed7f39e9b813` and runs the original integrity
validators unchanged. A pinned manifest checks every archived file and requires
the public historical reports and protocols to remain byte-identical. Missing,
extra, changed, or substituted archive entries fail. The archive is research
material and is excluded from the published runtime package.

The current implementation has separate, mandatory gates for its source-bound
paired replay and runtime qualification. Altering current code invalidates the
new evidence even when historical integrity still passes. Runtime tests,
typechecking, privacy checks, package checks, and required CI remain mandatory.

This is a reviewed evidence-lifecycle migration, not a rerun of the old private
transcript cohorts. Their original replay inputs were not recovered. The old
82% text-reduction observation, negative holdout, failed diagnosis attempts,
and later diagnosis observations remain findings about their evaluated version.
They are not new efficacy claims for 0.4.1.

## Current qualification

The [paired replay protocol](../research/early-diagnostics-protocol.json) freezes
nine complete logs from the development task, including successes and failures,
before the new comparison. Exit codes come from recorded command outcomes, not
guesses from log contents. Raw logs stay private. Public rows contain opaque
identities, hashes, byte/token counts, syntactic marker measurements, and
invariant results. Every selected row is retained. The 8 KiB routing threshold
and 128-token margin are unchanged.

This is a development/convenience cohort. The logs were already observed during
development, and they are not independent agent tasks or an unused holdout.
Named-tokenizer counts do not measure provider billing, model task success,
later log-read costs, or diagnosis quality.

In this cohort, the candidate retained six additional syntactic failure-marker
lines and lost none of the baseline-retained markers. The first marker became
visible in each of the three failures exceeding the suffix capacity. Total
presented text increased from 4,260 to 4,680 named-tokenizer tokens: 140 extra
tokens for each affected log. All nine cases still cleared the declared net
margin, including the charged instruction/invocation overhead. Two logs still
omitted markers. The full-read sensitivity calculation is counterfactual and
must not be reported as observed avoided reads or realized savings.

The [runtime protocol](../bench/early-diagnostics-protocol.json) compares native
execution, frozen v0.4, and the candidate on identical generated child commands.
It rotates arm order, retains every timing, and verifies original exits, one
execution, byte-exact private logs, short binary passthrough, and declared early
and final sentinels. Its explicit local acceptance budget limits the median
candidate-minus-baseline overhead per fixture to the greater of 20 ms or 25%
of baseline median time. That budget is an artifact qualification decision,
not a general performance guarantee. Shared-host noise remains in the report.

Exact observations are recorded in the
[paired replay report](../research/early-diagnostics-report.json) and
[runtime report](../bench/report/early-diagnostics-runtime.json). Controlled
fixtures establish the stated behavior; they do not prove that every useful
error will be selected.

The local macOS ARM64 / Node 24.20.0 runtime run retained all 594 command runs,
including warmups. All nine fixtures passed the declared contracts and median
latency budget. Per-fixture median candidate-minus-baseline time ranged from
-0.12 ms to +10.58 ms; the 1 MiB early-error fixture added 10.58 ms. The full
distribution, including slower individual observations (up to +301.53 ms),
remains in the report. Earlier pre-integration runs are also retained.

The September 29 completion study runs its checks through the existing required
test suite. All files bound to the replay report, including `scripts/check.ts`,
have the same bytes as when that replay was measured. A proposed edit to that driver
was withdrawn before a new private replay because the nine original private
logs were not recovered. Its [frozen amendment](../research/early-diagnostics-runs/424ff2d85da7ac8e78ff00b2310f435077d905af2768fe36373f946a9a864356.protocol.json)
and [runtime measurement](../bench/report/early-diagnostics-attempts/ca47ac7b5fd459d49b4d6d94d1c97fdd6ef54e68b41a6a24a9ba601e25a69234.json)
remain archived. The current runtime measurements above were rerun on the final
source. The historical private replay was checked against those unchanged files;
it was not rerun.

## Verify

`bun run check` includes the historical and current gates. Individually:

```sh
node research/validate-history.mjs
node research/early-diagnostics-replay.mjs --check
node bench/measure-early-diagnostics.mjs --check
```

The historical checker needs no private corpus and no Git history. The current
report checks verify source freshness, row completeness, invariants, and
arithmetic; they do not pretend to remeasure wall time or privately held logs
on every CI run. Generating new evidence requires its declared inputs and a
fresh measurement. A source change cannot be admitted by editing report hashes
alone.
