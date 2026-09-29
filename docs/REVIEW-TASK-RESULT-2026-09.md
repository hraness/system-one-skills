# Whole-task result: Sys1 review checkpoint in Claude Code (2026-09)

Plan: [`REVIEW-TASK-PLAN-2026-09.md`](REVIEW-TASK-PLAN-2026-09.md), committed at
`95eea25` before any task existed; directed-arm addendum at `fcba541`, before
any directed run. Data: [`bench/report/review-checkpoint-claude-code-2026-09.json`](../bench/report/review-checkpoint-claude-code-2026-09.json).

**Result: no saving. When Sys1 review was actually used, the whole task cost
more tokens, took longer, and gave fewer correct answers.** Neither trial meets
the plan's decision rule, so no whole-task saving claim may be made from it.

## Correction (2026-09-30)

Two of the 8 planted empty catches were invalid. In `wordcell-58bd07b6` and
`ghostget-56c2d81b` the planter stripped the only line from a catch that held a
comment and no code, so the catch was already empty and the plant added no
violation under the rule or the task prompt. Both labels should have been
`CLEAN`. The planter now skips comment-only catches
(`bench/claude-code-review-tasks.ts`). The data files are left unchanged; the
tables below keep the original 32-task counts.

Excluding the two invalid tasks leaves the result unchanged:

| Arm | Correct, without Sys1 | Correct, with Sys1 | Empty catch, without / with |
|---|---:|---:|---:|
| Adoption | 27/30 | 26/30 | 5/6 / 4/6 |
| Directed | 28/30 | **22/30** | 5/6 / **2/6** |

## Setup

- 32 tasks: real commits from 4 repositories (algal, wordcell, spongev2,
  ghostget), staged on their parent. 16 left clean, 8 with a planted new empty
  catch block, 8 with a test that lost its only assertion.
- Claude Code, Sonnet 5.5, headless, project settings only, no MCP servers.
  Same prompt in both arms: check the staged changes for those two problems and
  end with `ANSWER: CLEAN` or `ANSWER: VIOLATION <path>`.
- The Sys1 arm adds the `sys1-review` project skill, one CLAUDE.md line saying
  the repository uses Sys1 review with hosted Jev, `sys1` on PATH and a
  TypeSafe key. The baseline gets none of these.
- Arm order seeded per task; fresh copy-on-write clone per run.

## Adoption trial (as a team would set it up)

| | Baseline | Sys1 installed |
|---|---:|---:|
| Correct | 28/32 | 27/32 |
| Checkpoint actually run | – | **0/32** |
| Tokens, median change | | +1.5% saved, 95% CI −7.0% to +7.2% |
| Wall time, median change | | −4.6%, 95% CI −13.8% to +12.7% |
| Claude cost | $2.45 | $2.45 |

The agent read the staged diff itself every time. Installing Sys1 changed
nothing measurable.

## Directed trial (prompt says to use the checkpoint)

| | Baseline | Sys1, directed |
|---|---:|---:|
| Correct | 29/32 | **22/32** |
| – clean | 16/16 | 15/16 |
| – empty catch | 6/8 | **2/8** |
| – removed assertion | 7/8 | 5/8 |
| Checkpoint actually run | – | 32/32 |
| Tokens (total) | 3.49M | 6.34M |
| Tokens, median change | | **84% more**, 95% CI 68% to 113% more |
| Wall time (total) | 294s | 726s |
| Wall time, median change | | **145% more**, 95% CI 96% to 167% more |
| Claude cost | $2.46 | $3.31 |

## Why

1. **Workflow overhead.** A directed run loads the skill, lists rules, does a
   `--dry-run`, runs the checkpoint (8–40s of Jev requests on real diffs of
   2–20 files), and then usually greps the diff anyway to confirm. The baseline
   runs one `git diff --cached` and answers. Reading these diffs costs Sonnet
   less than the Sys1 procedure around them.
2. **Jev missed most planted problems.** Across the 16 planted tasks the
   checkpoint reported a finding in 3 (1/8 empty catches, 2/8 removed
   assertions), with no false positives on the 16 clean tasks. When the
   checkpoint came back empty the agent tended to trust it, which is where the
   accuracy loss comes from. In a one-file probe before the cohort, Jev caught
   both rules at 0.89–0.94 confidence, so recall drops sharply on realistic
   multi-file diffs. (Counted from the checkpoint JSON in each transcript;
   status was often `incomplete` under the agent's chosen request limit.)

## What this means for claims

- Do not claim Sys1 review saves tokens or time on whole tasks. Measured here,
  it costs more of both.
- Per-decision figures (a Jev call is fast and cheap) remain true but do not
  translate into a whole-task saving for a capable agent on these tasks.
- Before any further whole-task trial, the core rules need recall measured on
  realistic staged diffs. Only once recall is good does it make sense to
  shorten the skill procedure (drop the dry run, trust an empty result).

## Exclusions and spend

24 adoption pairs first ran after the Claude account hit its usage limit
(every run: 429, ~2s, $0). They were dropped before analysis and rerun after
the reset; the runner now stops on usage-limit errors. Spend: $10.84 of Claude
usage across the pilot, both trials and the reruns, plus Jev requests.
