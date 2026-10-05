# Recall result: Sys1 core rules on realistic staged diffs (2026-09)

Plan: [`REVIEW-RECALL-PLAN-2026-09.md`](REVIEW-RECALL-PLAN-2026-09.md)
(ref `review-recall-2026-09`, committed before any recall run).
Data: [`bench/report/review-recall-2026-09.json`](../bench/report/review-recall-2026-09.json).

Sys1 `main` at `b990d64`, route `typesafe/jev-1.13.0`. All 32 trial tasks were
rebuilt from their recorded commits; none were excluded.

## Correction (2026-09-30)

Two of the 8 planted empty catches were invalid. In `wordcell-58bd07b6` and
`ghostget-56c2d81b` the planter stripped the only line from a catch that held a
comment and no code, so the catch was already empty and the plant added no
violation under the rule or the task prompt. Both labels should have been
`CLEAN`. The planter now skips comment-only catches
(`bench/claude-code-review-tasks.ts`). The data files are left unchanged; the
tables below keep the original 32-task counts.

Against the 6 valid empty-catch plants, Jev recall is 1/6 under A and 0/6 under
B and C, so the conclusion stands. The local empty-catch detector that replaced
this Jev rule (sys1 PRs #82 and #83) catches 6/6 with no false positives on the
16 clean tasks.

## Result

| Condition | Empty catch | Removed assertion | False positives | Complete runs | Jev requests |
|---|---:|---:|---:|---:|---:|
| A. Default limits | 1/8 | 3/8 | 0/32 | 3/32 | 368 |
| B. High limits, run 1 | 0/8 | 3/8 | 0/32 | 3/32 | 431 |
| B. High limits, run 2 | 0/8 | 3/8 | 0/32 | 3/32 | 429 |
| C. Planted file and rule only | 0/8 | 3/8 | 0/16 | 16/16 | 37 |

B's two runs agree on every task. In C, where the checkpoint reviewed only the
planted file against only the matching rule and always completed, recall was
still 3/16. The plan's reading applies: **C low, so Jev misses these realistic
cases even in isolation.** Request limits and multi-file splitting are not the
cause.

The one A hit on an empty catch (`ghostget-c9aea466`) did not repeat under B or
C, so treat it as noise rather than evidence that the defaults help.

## Other findings

- Most checkpoints ended `incomplete` in A and B, even at 200 requests, because
  hunks over the unit size are skipped (`hunk_too_large`) and generated or
  binary files are excluded. The planted hunk was always evaluated, so this did
  not cause the misses, but an `incomplete` status on most real commits is
  worth fixing on its own.
- Example miss (`algal-1154cc4d-empty-catch`, `src/run.ts`): the diff removes
  all three statements from `catch (e) { ... }` and leaves it empty. Jev was
  asked about exactly that hunk and that rule and returned no finding.
- Zero false positives in every condition. The rules are conservative, not
  noisy.

## What this means

- The review checkpoint's weakness in the whole-task trial came from Jev's
  recall on these rules, not from the harness around it.
- Improving the rules' wording or examples, or the route, should be measured
  against condition C on these 16 planted tasks first: it is cheap (37
  requests) and repeatable.
- No whole-task or recall claim should be made for Sys1 review until C recall
  is high.

Spend: Jev requests only, no Claude usage.
