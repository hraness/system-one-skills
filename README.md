# System One Skills

System One Skills gives Devin, Claude Code, and Codex one skill,
`system-one-verify`, for long test and build logs. It runs the command once,
returns a short result with the exit status, and saves the full log on your
machine. It makes no model calls and needs no API key.

[Skills guide](https://sys1.io/skills) · [Measurements](#results) · [Report an issue](https://github.com/hraness/system-one-skills/issues)

## Install

Requires **Node.js 20+ on macOS or Linux**.

```sh
npm install --global https://github.com/hraness/system-one-skills/releases/download/v0.4.1/system-one-skills-0.4.1.tgz
system-one-skills --version
```

The [latest release, v0.4.1](https://github.com/hraness/system-one-skills/releases/tag/v0.4.1),
includes a SHA-256 checksum. Bun can install the same artifact. The runtime has
no package dependencies.

From your repository, install the skill for your agent:

| Agent | Command |
| --- | --- |
| Codex | `system-one-skills install-skills --target .agents/skills` |
| Claude Code | `system-one-skills install-skills --target .claude/skills` |
| Devin | `system-one-skills install-skills --target .devin/skills` |

The installer leaves matching files alone and refuses to overwrite a skill
that differs. Preserve your edits and choose an empty target if it reports a
conflict.

## Check the installation

Run a short check before using the wrapper with your test suite:

```sh
system-one-skills check -- node -e 'console.log("check ready")'
```

You see `check ready` and an exit status of zero. This short output passes
through unchanged. The command needs no agent session or API key. Next, run
one of your repository’s noisy checks as shown below.

## When to use it

Use the skill for a pass/fail check that earlier runs show produces at least
**8 KiB** of output. For example, ask your agent:

> Run the test suite with system-one-verify and inspect the saved log if it fails.

You can also run the wrapper directly:

```sh
system-one-skills check --timeout-ms 900000 -- bun test
```

Choose native tools when output is short, a useful quiet mode exists, or you
already need the full log. Do not run a check twice to measure its size. Keep
your repository's required validation commands.

## How it works

The command runs once. Short output passes through unchanged; long output is
reduced only when the excerpt is at least 50% and 4 KiB smaller. The result
preserves the command's exit status, shows selected output, and identifies any
omissions. Timeouts and capture failures return a failure status.

For shortened output, the `log=` line gives the saved log path. Short output
passes through without that line; use `--log` to choose a known path in either
case. Open the log when you need warnings, coverage details, or more context
to diagnose a failure. Logs
stay on your machine and may contain sensitive output; delete them when you no
longer need them.

## Commands

```sh
system-one-skills check -- npm test
system-one-skills check --cwd ./project --timeout-ms 900000 -- npm run build
system-one-skills check --log ./check.log -- sh -c 'npm test && npm run lint'
```

Arguments after `--` go directly to the command. Use an explicit shell for pipes
or chained commands. Keep any required host scheduler outside this command.
`--log` reserves a new private file and refuses to overwrite an existing path.

<details>
<summary>Operating limits</summary>

Commands are noninteractive. The default timeout is five minutes, adjustable
up to fifteen minutes, and the log limit is 64 MiB. Exceeding a limit stops the
command and reports a failure. Cancellation forwards the signal for cleanup,
then escalates after a grace period. Incomplete capture is disclosed; undrained
inherited pipes report `log_incomplete=true` and `cleanup_uncertain=true`.

The wrapper keeps a 256 KiB suffix in memory and, for failed commands, up to
2 KiB across 12 early diagnostic/context lines. Excerpts contain at most 6 KiB
of source bytes, with explicit gaps. Interleaved partial stdout/stderr lines
can hide a diagnostic. Use the full log when an excerpt leaves a question
unanswered. See the [failure-output behavior and measurements](https://github.com/hraness/system-one-skills/blob/main/docs/EARLY-ERROR-RETENTION.md)
for examples and limits.

</details>

## Results

In a September 2026 replay of **563 validation outputs** from one developer's
Codex and Devin sessions, `system-one-verify` reduced the UTF-8 text presented to the agent by
**35.20%**. It shortened 28 outputs and passed the other 535 through unchanged.
Every replay preservation check passed.

The [study and scorecard](https://github.com/hraness/system-one-skills/blob/main/docs/SCORECARD.md)
give the replay's provider breakdown, denominators, and preservation checks.
To measure whole-task token use, task success, and completion time, follow the
[benchmark protocol](https://github.com/hraness/system-one-skills/blob/main/docs/BENCHMARK-HARNESS.md).

<a id="all-skills"></a>

The [research catalog](https://github.com/hraness/system-one-skills/blob/main/docs/SKILL-CATALOG.md)
tracks proposed skills separately from this package. The
[research log](https://github.com/hraness/system-one-skills/blob/main/docs/RESEARCH-LOG.md)
and [completion-claim study](https://github.com/hraness/system-one-skills/blob/main/docs/COMPLETION-BASELINE-RESULTS-2026-09.md)
publish the broader findings.

## Compared with RTK

[RTK](https://github.com/rtk-ai/rtk) routes shell commands through an agent hook
to compress output automatically. Choose it for broad, hands-off compression.
`system-one-verify` wraps individual checks you already know are noisy and
saves their full logs locally.

## Why “System One”?

A System One skill handles a recurring operation so the coordinating agent can
use its context for the task. Here, ordinary code processes repetitive logs.
[TypeSafe's introduction to System One models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
explains the related model concept.

[Sys1](https://sys1.io) helps coding agents review changes against repository
rules. System One Skills works without it, and installing either project does
not configure the other.

System One Skills is [MIT licensed](LICENSE).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `invalid options or unavailable private log/skill target` | Run `system-one-skills --help`. Put wrapper options before `--`, and the command after it. For `--log`, choose a new file in an existing writable directory. |
| Skill installation reports a conflict | Preserve the existing skill and choose an empty target. The installer does not merge or overwrite differing files. |
| No `log=` line appears | Short output passes through unchanged. Choose `--log` when you need a predictable location regardless of output length. |
| A check reaches the timeout | Choose `--timeout-ms` between 1 and 900000. Use your repository’s normal runner for checks that need more than fifteen minutes or interactive input. |
| An excerpt does not explain a failure | Read the saved log. If `log_incomplete=true` appears, the capture is incomplete; do not treat it as the full command output. |
