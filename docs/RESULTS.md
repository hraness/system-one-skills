# Results in plain language

The current [numeric scorecard](SCORECARD.md) is the clearest headline: across
563 real validation outputs, `system-one-verify` presented **35.20% less UTF-8
text** (32.65% Codex, 38.90% Devin) with zero preservation failures. Among the
28 outputs that crossed the compaction guard, the reduction was 90.61%. This is
text-size evidence at the tool-result boundary, not provider-token or
whole-task savings. A [whole-task run in Claude Code](WHOLE-TASK-RESULT-2026-09.md)
found no token or time saving: Sonnet never called the skill on noisy
typechecks, because it already filtered the output with `grep`.
A [second run on the Sys1 review checkpoint](REVIEW-TASK-RESULT-2026-09.md)
also found no saving: when directed to use it, the agent spent 84% more tokens
and 145% more time, and Jev flagged 3 of 16 planted problems.
A follow-up [recall run](REVIEW-RECALL-RESULT-2026-09.md) found Jev
caught 3 of 16 planted problems even when given only the planted file and
matching rule.

The earlier development replay measured **82% fewer text tokens for noisy check
results**, in three successful Devin logs, including counted skill overhead.

The practical benefit is a smaller result for the agent to read while the check
still runs and its full log stays available. Use the skill for known noisy
pass/fail checks. Native tools are a better fit for short output, useful quiet
modes, or tasks that need the whole log.

## What the headline counts

| Across the three qualifying logs | Text tokens |
| --- | ---: |
| Original output | 9,731 |
| Compact result | 931 |
| Counted skill, discovery, and invocation overhead | 774 |
| Result plus overhead | **1,705** |
| Net reduction | **8,026 (82.48%)** |

The headline rounds `(9,731 − 931 − 774) / 9,731` to **82%**. This is the combined
reduction across the three logs, not the average reduction per log or a prediction
for a typical agent task. The individual reductions were approximately 63%, 78%,
and 91%. We use the combined result rather than highlight the best case.

The data comes from the [v0.4.0 admission report](../research/admission-report.json)
and [per-case measurements](METRICS.md). The output contains 90% fewer tokens
before overhead, but that larger percentage omits part of the cost and is not
our headline.

**The comparison is with the archived output, not the best quiet reporter.**
All three favorable excerpts contain Bun test output; one also contains preceding
checks and another contains a structured runner envelope. Bun 1.3.14's installed
help provides `--dots` and `--only-failures`. Those modes were not measured on the
original repository snapshots. The replay therefore does not establish that
this wrapper beats Bun's native reporting. Use an adequate native quiet reporter
first; preserving any other required output still matters.

## What stays the same

The runtime executes the command once, returns its exit status, and keeps the
complete captured output in a private local log. It reports timeouts, resource
limits, and incomplete capture. An excerpt is never a complete diagnosis.

The [runtime evidence](RUNTIME-EVIDENCE.md) includes 25 tests of these contracts.
This supports the documented behavior; it does not establish better agent task
success or fewer diagnostic mistakes. A later full-log read can reduce or erase
the initial token benefit.

## What happened on a failed check

A separate retrospective audit found **one qualifying noisy failure** in the
retained transcripts. Its compact result used **66% fewer text tokens**, including
the same counted first-use overhead. It preserved the seven failed test identities
and their shared error message, but omitted six of their seven source locations.
That supports a quick failure summary, not complete diagnosis.

Reading the entire original log afterward would erase the saving. A targeted
lookup may cost less; actual agent follow-up usage was not measured. Removing
terminal colors before replay still gave a 58% reduction in this one case, so
color codes explain part of the raw-log benefit. The [failure audit](FAILURE-EVIDENCE.md)
publishes the selection, independently reviewed labels, and exact counts.

**A live follow-up found a much smaller difference.** In one completed Codex
comparison, both answers passed all six diagnosis criteria. The skill run used
**47,840 recorded tokens versus 49,803 with focused native reads: 3.9% fewer**,
including follow-up reads. It also took 38.0 seconds versus 28.6 seconds by the
launcher clock. This is no evidence of better reliability or speed, and one
case with uncontrolled cache effects cannot establish general token savings.
The [diagnosis results](DIAGNOSIS-RESULTS.md) include failed setup attempts,
provider counters, timing limits, and the blind review method.

## Why the package stays small

New analysis screened **outputs from 960 calls** in real Codex, Claude Code, and
Devin transcripts. Many search and repository-state results were already small.
The screen calculates whether a proposed output reducer could meet a savings
target even if it removed the entire output. Passing that optimistic screen
does not establish a useful or correct skill; failing it rules out that particular
cost-and-margin scenario.

We also ran one existing repository test file with Bun's normal and quiet
reporters. Native `--dots` reduced output-plus-command text from **466 to 55 tokens**,
with the same observed 21 passing tests, zero failures, and 106 assertions. This
was a short successful check, precisely where the wrapper should not be used.
The test file exercises synthetic inputs; the reporter measurement is a real
command run, not a transcript replay or a task-success experiment. No equivalent
claim is made about warnings, failing tests, or the older project snapshots.

The [candidate analysis](CANDIDATE-EVIDENCE.md) gives each measured workflow's
cost limits and native alternatives. All ten unqualified candidates remain
outside the install. Better numbers must come from useful behavior, not from
comparing against needlessly verbose commands.

## When the benefit disappears

All 21 short logs in the development sample and all 14 selected logs in the
[unused historical cohort](HOLDOUT.md) fell below the 8 KiB routing threshold.
Their output passed through unchanged. Unnecessary use would add 258 counted
first-use tokens per case. Always-visible skill discovery can also cost tokens
on tasks that never invoke it.

The [CI pilot](CI-PILOT.md) found no established advantage over native run
watching. That candidate and the other nine research candidates stay outside
the installation. A common workflow alone does not justify another skill.

## Data notes

1. **Small development sample.** The favorable result uses three successful noisy
   Devin logs selected from 24 eligible replay excerpts. These examples helped
   tune the implementation. The broader research includes real Codex and Claude
   transcripts; it does not establish equivalent savings for those agents.
2. **Text counts, not bills.** Counts use `tiktoken 0.12.0` with `o200k_base`.
   The estimate includes counted skill text, discovery, and representative added
   command text. It excludes complete task prompts, provider framing, cache
   pricing, reasoning, retries, subagents, and later log reads. The original
   commands were not rerun; archived text was replayed through the reducer.
3. **Known-noisy routing.** Eligibility uses an archived output size of at least
   8 KiB as a prior observation. The replay does not measure whether an agent
   would choose correctly or whether the next execution stays noisy.
4. **Local cost.** A separate synthetic runtime test measured about **42 ms median
   added processing time** across 140 native/wrapper pairs on a shared macOS
   arm64 host, Node 24.20.0. The p95 was 48.37 ms. This is overhead, not faster
   completion. [Raw timings and setup](RUNTIME-EVIDENCE.md).
5. **Evidence owner.** These are agent-authored analyses of one consenting
   developer’s private transcripts. Public reports contain aggregates and opaque
   hashes; raw transcript text remains private. Findings were checked on
   September 20, 2026 UTC against the unchanged v0.4.0 runtime.

## What would justify a stronger claim

The next useful analysis is a comparison on previously unused **complete noisy
check tasks**, including failures, against the best native quiet or bounded
output. Count actual provider usage, every follow-up read and retry, correct
failure diagnosis, and time to completion. More transcript volume without those
comparisons would not establish a cheaper, faster, or more reliable agent.

The [whole-task trial protocol](../bench/TRIALS.md) sets those requirements.
Until that evidence exists, the headline describes the measured check-result
reduction only. The [research log](RESEARCH-LOG.md) preserves the complete findings.
