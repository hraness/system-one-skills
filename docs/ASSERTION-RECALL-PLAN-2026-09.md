# Recall plan: `core-removed-test-assertions` on realistic diffs (2026-09)

Plan ref: `assertion-recall-2026-09`. Written before any case was generated or run.

## Question

The earlier recall run ([result](REVIEW-RECALL-RESULT-2026-09.md)) scored this
rule at 3/8. Checked against the rule's wording, 4 of those 8 plants were not
violations: two left an explicit throw-on-failure check in a callback longer
than the diff context, one was a new file (no retained callback), and one cut a
multi-line `expect` in half. Two of the 3 hits were the same plant in two
commits. The sample was too small and too noisy to say whether Jev handles this
rule. This run measures it on a larger set built to the rule's own terms.

## Cases

Built by `bench/assertion-recall.ts generate` with seed `assertion-recall-2026-09`
from each repo's non-merge commits in the last 365 days that modify (not add) a
TypeScript test file. Each commit yields at most one case, kinds rotate
`violation`, `near-miss`, `clean`, and no test callback is used twice.

A callback qualifies only if it is a `test(`/`it(` callback that is identical in
the commit and its parent (retained and unchanged), is at most 28 lines, has no
nested block, calls no `check*`/`verify*`/`assert*`/`ensure*`/`must*` helper,
contains no `throw`, `assert`, `fail(` or `t.*` check, and every `expect` in it
is a complete one-line statement.

- **violation**: the callback's only `expect` statement is deleted. The deleted
  line is at most 14 lines from each end of the callback, so the whole callback
  is inside Sys1's 15-line diff context.
- **near-miss** (clean): one of two or more `expect` statements is deleted; an
  assertion remains.
- **clean**: the commit as made, with no plant. Excluded if the commit itself
  deletes a line containing `expect(`, `assert` or `throw` from that file.

**Calibration** repos (seen in earlier runs): algal, wordcell, spongev2,
ghostget. **Held-out** repos: design-kit, peopleblade, sys1, wrench, algal-lab,
algal-cloud. Target: up to 30 cases of each kind per set. Actual counts are
reported. Every violation and near-miss diff is read once by hand before any
run; a case judged outside the rule is excluded and listed with the reason.

## Run

Sys1 `main` at the commit recorded in the report, route `typesafe/jev-1.13.0`,
fresh `SYS1_HOME` per case: `sys1 review checkpoint --staged --json
--max-requests 200 --timeout-ms 120000 --rule core-removed-test-assertions --
<test file>` (the earlier condition C). Each set is run once. Only Jev calls;
no agent.

## Measures and decision

- **Recall**: violations with a finding for the rule on the planted file.
- **False alarm rate**: near-miss and clean cases with any finding, reported
  separately and combined.
- Wilson 95% intervals for all rates.

The current rule is **adequate** if held-out recall is at least 80% and the
held-out combined false alarm rate is at most 5% (the bar in sys1
`docs/proof-roadmap-2026-09.md`). Otherwise it is **inadequate**, and any rule
change is tuned on the calibration set only and then scored once on held-out.
Runs that error or come back incomplete are counted as misses for violations
and reported separately.
