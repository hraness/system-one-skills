# System One Skills

System One Skills gives Devin, Claude Code, and Codex one skill,
`system-one-verify`, for test and build commands you already know produce long
logs. It runs the command once, returns a short result with the exit status, and
saves the full log on your machine for when the agent needs details. It makes no
model calls and needs no API key or runtime dependency.

[Skills guide](https://sys1.io/skills) · [Source](https://github.com/hraness/system-one-skills) · [Sys1](https://sys1.io)

## When to use it

The agent gets the exit status and a short excerpt instead of pages of passing
tests. The command runs once, and a timeout or capture failure is reported as a
failure. The full log stays on disk for warnings, coverage questions, and
diagnosis.

Choose native tools when output is short, a useful quiet mode exists, or you
need the full log anyway.[^2] Better task success and faster completion have not
been shown.

```sh
system-one-skills check --timeout-ms 900000 -- bun test
```

## Results

In a replay of **563 real validation outputs** from one developer's local Codex
and Devin sessions, `system-one-verify` cut the text the agent would see by
**35.20%**: 32.65% for Codex (356 outputs) and 38.90% for Devin (207 outputs).
Claude Code had no qualifying validation outputs in this window, so it has
**No result**. The 28 outputs the skill shortened were 90.61% smaller, and the
other 535 short outputs passed through unchanged. Every replay preservation
check passed.

This measures text size, not provider tokens or whole-task usage, and no
whole-task token reduction has been measured yet. The [numeric
scorecard](docs/SCORECARD.md) gives the denominators, provider breakdown,
preservation checks, and the reason each other candidate is still unmeasured.
Earlier exploratory 82% and 3.9% figures are in the [results
notes](docs/RESULTS.md) with their narrower scopes.[^1][^3]

## Compared with RTK

[RTK](https://github.com/rtk-ai/rtk) installs an agent hook that rewrites 100+
shell commands and compresses their output automatically. Use it for broad,
hands-off compression. `system-one-verify` wraps one check you already know is
noisy, saves the complete log, and reports a timeout as a failure. Its 35.20%
figure comes from replaying 563 real outputs. Checked September 2026.


## Install

Requires **Node.js 20+ on macOS or Linux**.

```sh
npm install --global https://github.com/hraness/system-one-skills/releases/download/v0.4.1/system-one-skills-0.4.1.tgz
system-one-skills install-skills --target .agents/skills
```

The [versioned release](https://github.com/hraness/system-one-skills/releases/tag/v0.4.1)
includes a SHA-256 checksum. Bun can install the same artifact. Use your agent’s
skill directory, such as `.claude/skills` or `.devin/skills`, where appropriate.
Existing modified skill files are never silently overwritten.

## How it works

1. **Run once.** Execute the original command and capture its output locally.
2. **Return a compact result.** Keep the exit status and selected evidence,
   disclose omissions, and print the full log’s location.
3. **Inspect only when needed.** Open the log for details the excerpt cannot answer.

The skill selects checks known from earlier runs to produce at least **8 KiB**.
Short output passes through unchanged; long output is reduced only when it is at
least 50% and 4 KiB smaller. Do not run a check twice just to measure its size.
Timeouts and capture problems are reported as failures. Required repository gates
still apply. Tested preservation behavior and local processing cost are documented
in the [results notes](https://github.com/hraness/system-one-skills/blob/main/docs/RESULTS.md).

## All skills

Only `system-one-verify` ships. The ten other names are research candidates
with **No numeric result**; each needs a working adapter and evidence that it
beats native tools before it joins the package.

| Skill | Verified reduction | Discovery signal | What to use today |
| --- | --- | --- | --- |
| `system-one-verify` | **35.20% less validation text** across 563 real outputs; 100% preservation checks | 563 replay outputs; 35.20% is text-boundary evidence only | **Available:** known noisy pass/fail checks when native quiet output is inadequate |
| `system-one-explore` | **No result** | 213/573 calls cross an illustrative 256-token headroom screen (37.17%); not savings | Focused native search; research must prove it preserves required locations |
| `system-one-ci` | **No result** | 128 Devin CI-status calls in the pilot; avoidable polling not measured | Native run watching (`gh run watch`) |
| `system-one-diff` | **No result** | 31/68 calls cross the same headroom screen (45.59%); not savings | Scoped native diffs; research must measure missed findings |
| `system-one-digest` | **No result** | 28/224 calls cross it (12.50%); not savings | Native Git status; most observed outputs were already too small to justify another layer |
| `system-one-fetch` | **No result** | 54/95 shared web calls cross it (56.84%); not an independent cohort | The agent's readable-page tool; extraction accuracy and extra savings are unproven |
| `system-one-research` | **No result** | Same 54/95 shared web calls as fetch; do not add the totals | Native search and targeted reads; no separate benefit demonstrated |
| `system-one-triage` | **No result** | No dedicated labeled cohort | Deterministic rules or the primary agent; no evaluated decision family yet |
| `system-one-writing` | **No result** | No dedicated labeled cohort | Existing linters; inactive until there is relevant task evidence |
| `system-one-evolve` | **No result** | No dedicated labeled cohort | A fixed reviewed policy; inactive until optimization can repay its cost |
| `system-one` | **No result** | No dedicated labeled cohort | Direct selection; an extra router is unjustified for one available skill |

The [full catalog](https://github.com/hraness/system-one-skills/blob/main/docs/SKILL-CATALOG.md)
explains the proposed benefit, native alternative, and evidence needed for each.
The [research log](https://github.com/hraness/system-one-skills/blob/main/docs/RESEARCH-LOG.md)
publishes positive and negative findings. New skills must save tokens on complete
tasks while meeting correctness and latency requirements.

The discovery percentages in the table are **not reductions**. They answer one
narrow question: how many observed outputs were at least 256 `o200k_base` text
tokens, leaving a hypothetical 128-token skill overhead and 128-token margin.
They assume perfect deletion, so they cannot justify installing a candidate or
be compared with the 35.20% validation-text result. Fetch and research share
one 95-call web proxy and must not be added together. The [catalog scorecard](docs/SCORECARD.md)
publishes the denominators, provider split, and current decision for every
entry.

Recent analysis covers [a real failed check](https://github.com/hraness/system-one-skills/blob/main/docs/FAILURE-EVIDENCE.md)
and [outputs from 960 calls plus native reporter alternatives](https://github.com/hraness/system-one-skills/blob/main/docs/CANDIDATE-EVIDENCE.md).[^4]
The failure summary saved tokens but needed the full log for some details;
the candidate analysis gives us reasons to keep the install small.
A [live Codex diagnosis comparison](https://github.com/hraness/system-one-skills/blob/main/docs/DIAGNOSIS-RESULTS.md)
also counts follow-up reads and keeps failed setup attempts in the evidence record.

We are prioritizing **more useful failure excerpts** and **focused search with
needed source lines** over a larger catalog. Both must beat the corresponding
native workflow on total tokens, correctness and completion time before a new
skill or expanded workflow earns a place in the package. The [catalog's research priorities](https://github.com/hraness/system-one-skills/blob/main/docs/SKILL-CATALOG.md#next-experiments)
explain the specific evidence gaps.

The bounded early-error retention update in v0.4.1 stays within the existing
check wrapper. Its separate source-bound artifact qualification verifies
preservation and local processing cost; it neither admits another workflow nor
establishes a whole-task benefit.

The [whole-task benchmark harness](https://github.com/hraness/system-one-skills/blob/main/docs/BENCHMARK-HARNESS.md)
is now the path to stronger claims: it selects relevant task episodes before
outcomes, pairs each skill with the best native workflow, and reports Codex,
Claude Code, and Devin separately. The current 3.9% diagnosis result remains
one exploratory pair until that process produces held-out matched tasks; the
harness itself has no efficacy result yet.

A new [screen of 1,200 real file reads](https://github.com/hraness/system-one-skills/blob/main/docs/CANDIDATE-OPPORTUNITIES.md)
also argues against adding a generic read-reuse skill. Exact repeats accounted
for only **1.1% of read-output text**, before instructions or freshness checks.
That is an optimistic opportunity ceiling, not a measured saving.

<a id="commands"></a>

<details>
<summary><strong>Commands and operating limits</strong></summary>

```sh
system-one-skills check -- npm test
system-one-skills check --cwd ./project --timeout-ms 900000 -- npm run build
system-one-skills check --log ./check.log -- sh -c 'npm test && npm run lint'
```

Arguments after `--` go directly to the command. Use an explicit shell for pipes
or chained commands. Keep any required host scheduler outside this command.
`--log` reserves a new private file and refuses to overwrite an existing path.

Commands are noninteractive, with a five-minute default timeout, adjustable up
to fifteen minutes, and a 64 MiB log limit. Exceeding a limit stops the command
and reports a failure; incomplete capture is disclosed. Cancellation forwards
the signal for cleanup, then escalates after a bounded grace period. Undrained
inherited pipes produce `log_incomplete=true` and `cleanup_uncertain=true`.
The in-memory suffix is limited to 256 KiB. A separate bounded capture keeps up
to 2 KiB across 12 early diagnostic/context lines for failed commands, including
when later output displaces them from the suffix. Gaps remain explicit; excerpts
preserve the existing suffix selection and add at most 2 KiB of early evidence,
for at most 6 KiB of retained source bytes. They do not promise complete
diagnostic coverage. The matcher follows the full log’s
observed stdout/stderr chunk order. Interleaved partial lines or characters can
hide a diagnostic; it does not reconstruct separate logical streams.
The [early-error evidence](https://github.com/hraness/system-one-skills/blob/main/docs/EARLY-ERROR-RETENTION.md) separates current
qualification from the historical v0.4 findings. Default logs use a private
temporary directory. They may contain sensitive output;
delete them when no longer needed.

</details>

## Why “System One”?

A System One skill handles a small recurring operation so the coordinating agent
can use its context for the task. Here, ordinary code processes repetitive logs.
[TypeSafe’s introduction to System One models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
is related background; this collection needs no model backend or TypeSafe account.

[Sys1](https://sys1.io) is a separate project that gives agents yes/no, choice,
and score decisions from local models, hosted Jev, or compatible servers. System
One Skills works without it, and installing either project does not configure
the other. [Sys1 source](https://github.com/hraness/sys1).

[^1]: **Early text replay.** Three noisy
    successful logs qualified from 24 Devin development replays. Their 9,731 tokens
    became 931 output tokens plus 774 counted skill, discovery, and invocation
    tokens. `(9,731 − 1,705) / 9,731 = 82.48%`, rounded to 82%. Counts use
    `o200k_base`; retries, later log reads, and complete agent usage were not
    measured. These examples helped tune the implementation. Native quiet
    reporters were not compared on those historical tasks.
    [Calculation and limits](https://github.com/hraness/system-one-skills/blob/main/docs/RESULTS.md).

[^2]: **Short checks can cost more.** The 21 short development replays and 14
    selected replays from an unused Claude/Devin cohort did not qualify. Wrapping
    them adds instruction overhead without reducing their output. Installing a
    skill can also add catalog overhead on tasks that never use it. Faster task
    completion and better task success remain unproven.
    [Negative results](https://github.com/hraness/system-one-skills/blob/main/docs/HOLDOUT.md).

[^3]: **One observed diagnosis.** One historical
    Devin failure was diagnosed by Codex in two fresh sessions, reduced first
    and native second. The skill arm made four reads versus three and took
    37.974 seconds versus 28.625 seconds from launcher start to exit. Cache
    effects were uncontrolled; the model checkpoint and ambient instructions
    were not fully attested. A blinded rubric scored both answers 6/6. Failed
    setup attempts add evaluation cost and are not subtracted from these arms.
    [Complete results and limitations](https://github.com/hraness/system-one-skills/blob/main/docs/DIAGNOSIS-RESULTS.md).

[^4]: **Native control run.** Each reporter returned
    21 passed tests, 0 failed, 106 assertions and exit 0 in one run per mode.
    Matching totals do not establish equivalent warning visibility or failure
    diagnosis. Text counts use `o200k_base`, not provider billing.
    [Native baseline and candidate screen](https://github.com/hraness/system-one-skills/blob/main/docs/CANDIDATE-EVIDENCE.md).

<details>
<summary><strong>Development and assessment</strong></summary>

```sh
bun install --frozen-lockfile
bun run check
bun bench/run-bench.ts
bun bench/assess-trials.ts private-observed-trials.json
```

The aggregate gate checks runtime behavior, skill footprint, immutable v0.4
historical evidence, separate source-bound current replay and runtime qualification,
privacy, and package contents. The [trial protocol](https://github.com/hraness/system-one-skills/blob/main/bench/TRIALS.md)
requires a strong native baseline, unused tasks, complete token accounting,
independent correctness evaluation, and measured completion time. Correctness
or material latency regressions block adoption. Synthetic tests check behavior;
real transcript replays measure text reduction. MIT licensed.

</details>
