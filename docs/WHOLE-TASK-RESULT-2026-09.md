# Whole-task result: system-one-verify in Claude Code (2026-09)

Plan: [WHOLE-TASK-PLAN-2026-09.md](WHOLE-TASK-PLAN-2026-09.md), committed before
any cohort pair ran. Per-pair data: [whole-task-claude-code-2026-09.json](../bench/report/whole-task-claude-code-2026-09.json).

## Result

**No measurable token or time saving.** Claude Code (Sonnet 5.5) never used the
skill, because it already kept the noisy output out of its context.

| 26 pairs, 7 repositories | Without skill | With skill installed |
| --- | ---: | ---: |
| Correct answers | 24 | 24 |
| Times the skill was used | – | 0 |
| Total tokens processed | 2,762,336 | 2,694,284 |
| Paired median token change | | −0.07% (95% CI −0.67% to +0.16%) |
| Total wall time | 557 s | 583 s |
| Paired median time change | | −3.8% (95% CI −14.0% to +3.8%) |
| Claude cost | $2.02 | $2.29 |

The decision rule needed 30 pairs and an interval that excludes zero. This run
has 26 pairs and both intervals include zero, so it supports no saving claim.
It also shows no quality regression.

## Why

Each task asked the agent to run a failing `bun run typecheck` (8–35 KiB, 65–270
errors) and report the exit code, error count and renamed identifiers. In every
arm, with or without the skill, the agent redirected the output to a file and
read it with `grep`, `sort | uniq -c` and `tail`. The largest single tool result
any agent read was 9.2 KiB; the median was 1.3 KiB. With the noise already
filtered by the agent's own shell, there was nothing left for the skill to
compress, and the agent correctly left it unused.

The small cost gap is prompt-cache ordering and the skill listing, not skill
calls: the arm that ran first in a pair paid to fill the cache.

## What this does and does not say

- It measures one task shape: a known noisy check, a capable agent, and a
  question answerable with `grep`. It does not measure long agent sessions where
  full logs are read, weaker models, or agents without a shell.
- The 35% text reduction in [SCORECARD.md](SCORECARD.md) stands. It measures
  what the skill does when called; this run measures whether a Sonnet agent
  calls it on these tasks. Here it did not.
- Two tasks were missed by both arms: generic renamed names (`config`,
  `generate`, `unit`, `settle`) also appear in unrelated error text, and every
  agent named only the distinctive identifier. That is answer-key ambiguity and
  affects both arms equally.

## Deviations from the plan

- The plan text says the two-rename pass yielded 17 tasks; it was written while
  generation was still running, and the final count was 19. The three-rename
  supplement ran exactly as planned and added 7.
- Generation shared the machine with the first pairs, so wall times include some
  CPU contention. Arm order within each pair is randomized, so both arms share it.
- Seed: the plan commit `03ebd82`, fixed before any cohort pair ran.
- Spend: $4.32 of the $20 budget, including the pilot.
