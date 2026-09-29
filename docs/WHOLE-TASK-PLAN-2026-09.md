# Whole-task trial plan: system-one-verify in Claude Code (2026-09)

Plan ref: `whole-task-cc-verify-2026-09`. Written before any cohort pair ran. The
one pilot pair (`pilot-wordcell-test`) is development data and is excluded.

## Question

When `system-one-verify` is installed as a project skill, does Claude Code
(Sonnet 5.5) finish a noisy-check task with fewer total tokens and less wall time,
without a worse answer, than the same agent without the skill?

## Arms

- **Baseline:** Claude Code with project settings only, no MCP servers, tools
  `Bash Read Grep Glob Skill`, editing tools denied. The agent is free to use any
  native strategy (redirect to a file, `tail`, `grep`, quiet flags).
- **Skill:** identical, plus `system-one-verify` v0.4.1 in `.claude/skills`. The
  prompt does not mention the skill. Whether the agent invokes it is part of the
  measured behaviour, and each skill-arm record says whether it did.

Each arm runs in a fresh copy-on-write clone of a frozen snapshot, with no session
persistence, sequentially, in an order set by `sha256(seed:task_id)`.

## Tasks

Fault-injected typecheck tasks from `bench/claude-code-faults.ts`, modelling a
half-finished rename: two widely used exports, defined in different files, are
renamed at their definitions. A task is kept only if `bun run typecheck` then
emits at least 8 KiB (the point where the skill starts compressing), at least one
`error TS` line, and both names. The observed exit code, error count and both
identifiers are frozen as the answer key when the task is generated. Each export
is used by at most one task, at most 4 tasks per repository, and each task is its
own cluster.

Design change recorded before any cohort run: single-rename faults were tried
first, and in `algal` and `sys1` 15 of 16 produced 0.03-6.7 KiB, below the skill's
8 KiB threshold, so the skill would pass that output through unchanged. That
prevalence is part of the result: everyday single-symbol type errors are too small
for `system-one-verify` to act on.

## Measures

1. **Primary, tokens:** total processed tokens per arm =
   `input + cache_creation_input + cache_read_input + output` from the Claude Code
   result record. Dollar cost is reported but not used for the claim, because
   whichever arm runs first pays to fill the shared prompt cache (seen in the
   pilot: equal tokens, 2.2x cost gap).
2. **Primary, time:** wall time from process start to result record.
3. **Quality gate:** the `ANSWER:` line must match the frozen exit code, error
   count and both identifiers. Graded mechanically, blind to arm.

## Decision rule

- A token or time claim needs at least 30 completed pairs, no quality regression
  (skill-arm correct answers >= baseline correct answers), and a paired
  median reduction whose 95% bootstrap interval excludes zero.
- Tokens and time are judged separately. A win on one is not a win on the other.
- If the skill arm rarely invokes the skill, the result is reported as-is: that
  is what an installed skill does for users.
- All completed pairs are reported, including losses. No task is dropped after
  it runs.

## Budget

$20 total Claude usage, $0.60 cap per arm, enforced by the runner ledger. The
run stops before a pair that could exceed the total.
