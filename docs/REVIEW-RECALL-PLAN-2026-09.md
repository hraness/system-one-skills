# Recall plan: Sys1 core rules on realistic staged diffs (2026-09)

Plan ref: `review-recall-2026-09`. Written before any recall run.

## Question

In the whole-task review trial ([result](REVIEW-TASK-RESULT-2026-09.md)) the
Sys1 checkpoint reported 3 of 16 planted problems inside agent sessions. Is
that a Jev miss, a request budget or deadline cut, or a problem with how the
change is split into review units? No agent is involved here: Sys1 is run
directly.

## Tasks

The same 32 tasks as the trial (`bench/report/review-checkpoint-claude-code-2026-09.json`):
16 clean real commits, 8 with a planted emptied catch block, 8 with a test that
lost its only assertion. Snapshots are rebuilt from the recorded commits with
seed `95eea25`; a task whose rebuilt planted path differs from the record is
excluded and reported. Both plants are inside the rule text:
`core-new-empty-catch` covers a catch "emptied by removing its last
executable statement", and `core-removed-test-assertions` covers a retained
callback losing its last assertion.

## Conditions

All on route `typesafe/jev-1.13.0`, `--staged --json`, fresh `SYS1_HOME`:

- **A. Default**: `--max-requests 20 --timeout-ms 30000` (Sys1 defaults).
- **B. Unbounded**: `--max-requests 200 --timeout-ms 120000`.
- **C. Isolated** (planted tasks only): condition B restricted to the planted
  file (`-- <path>`) and the matching rule (`--rule`).

Condition B is run twice to check repeatability.

## Measures

- **Recall**, per rule: planted tasks with a finding for the matching rule on
  the planted path.
- **False positives**: clean tasks with any finding, and planted tasks with a
  finding on another path.
- Diagnostics: checkpoint status, whether the planted path was among the
  evaluated targets, requests, Jev tokens, elapsed time.

No pooled score. This is diagnostic evidence for Sys1 development, not a
marketing claim. It makes no whole-task saving claim.

## Reading the result

- A low, B high: the budget or deadline is the cause.
- B low, C high: multi-file context or unit splitting is the cause.
- C low: Jev misses these realistic cases even in isolation.
