# Measured value: known noisy validation

Use `system-one-verify` when earlier runs already establish at least **8 KiB of
output** and the task needs the command's exit status. Use native tools for
short output or detailed log analysis. Do not run a command merely to measure
its verbosity.

The initial **development/calibration** sample contains 24 real completed Devin
validation outputs. Three satisfy the 8 KiB selection rule. For those three,
the shipped reducer changes **9,731 output tokens to 931**, with another
**774 tokens charged for skill instructions, catalog descriptions, and
incremental invocations**: **8,026 net text tokens saved** under the named
`o200k_base` encoding. Each selected case clears the required 128-token margin.

This is measured text reduction on the examples used to tune the reducer. It
is not an independent held-out result, provider-billing measurement, or proof
of complete task correctness. The full machine-readable evidence is in
[admission-report.json](../research/admission-report.json).

## Per-case results and negative examples

| Archived output | Raw tokens | Presented tokens | First-use overhead | Net tokens saved |
| --- | ---: | ---: | ---: | ---: |
| 8,207 bytes | 1,840 | 415 | 258 | 1,167 |
| 9,876 bytes | 2,348 | 253 | 258 | 1,837 |
| 22,040 bytes | 5,543 | 263 | 258 | 5,022 |
| **Selected total** | **9,731** | **931** | **774** | **8,026** |

The other **21 cases remain in the report**. Their output passes through
unchanged; invoking the skill on them would add 258 first-use accounting tokens
per case. All three selected logs are successful checks. Four recorded failures
are present in the sample, but all are below the selection threshold. There is
therefore no empirical long-failure savings claim from this sample.

The size rule uses archived size as a stand-in for an available previous
observation. Actual agent selection and next-run size stability were not
measured. Cases are not selected by whether their token result was favorable.

| Simulated size threshold | Selected cases | Cases failing 128-token margin |
| --- | ---: | ---: |
| 4 KiB | 7 | 4 |
| **8 KiB** | **3** | **0** |
| 16 KiB | 1 | 0 |
| 32 KiB | 0 | 0 |

## What is charged

Token counts use local `tiktoken` **0.12.0**, encoding **`o200k_base`**. They are
actual counts for that encoding, not a bytes-divided-by-four estimate or a claim
about Devin/Claude model tokenization.
Presented tokens include the actual replay artifact paths. Those paths contain
longer sample identifiers than the default CLI path and add conservative
overhead; fresh temporary-directory nonces can slightly change rerun counts.

| Instruction/invocation component | Tokens |
| --- | ---: |
| Full skill file, charged on every case | 204 |
| Catalog name and description, also charged | 42 |
| Native invocation estimate | 6 |
| Skill invocation estimate | 18 |
| **Incremental first-use total: 204 + 42 + 18 − 6** | **258** |
| Common task-instruction estimate, charged equally to both arms | 13 |

Original complete user/system prompts were not retained with the replay
samples. The common 13-token instruction is explicitly constructed and cancels
in the comparison; it is not recovered prompt history. Skill-loading
interactions, provider chat framing, reasoning, caches, retries, and later
full-log retrieval remain unmeasured. The report preserves these limits.

## Three-provider grounding and coverage

| Transcript source | Calls in September 12–18 UTC | Calls September 19 before 14:00 UTC | Eligible completed validation outputs | Sampled / selected |
| --- | ---: | ---: | ---: | ---: |
| Codex | 229 | 0 | 0 | 0 / 0 |
| Claude Code | 30 | 2 | 0 | 0 / 0 |
| Devin CLI | 2,992 | 4,554 | 207 | 24 / 3 |

The analyzer chooses up to 12 eligible outputs per provider per cohort by
smallest opaque hash. These two cohorts contribute 7,807 recorded tool calls;
overlapping nested Codex telemetry is kept separate. Strict replay rules did
not yield eligible Codex or Claude validation outputs in these windows. Their
real corpus coverage must not be described as evidence of this skill's savings
on those agents. The corpus belongs to one developer and retained ancestry may
omit compacted history.

## Preservation and admission

All 24 replays pass the ten scoped preservation checks: correct byte counts,
exact passthrough or marked compaction, exit/omission/path disclosures, capture
bound and size guards, complete archived-excerpt storage, and private file
permissions. They replay text through the actual reducer without executing any
archived command. Storage checks validate the replay harness; separate CLI
integration tests validate real process capture and exit behavior.

A separate synthetic forward check preserved exit 42 and one-time execution.
Its early colored diagnostic required one targeted read of the saved log to
explain the failure. That check exposed a matching gap: the reducer now ignores
SGR color sequences when identifying diagnostic lines while preserving their
original bytes. A regression covers this case. This is synthetic development
evidence, not another real transcript or measured end-to-end savings result;
the extra read illustrates a cost that the token table does not include.

The public gate checks source/report freshness, three-provider corpus coverage,
all preservation results, retained negative examples, and a margin of at least
128 tokens for every case selected by the fixed rule. Hashes detect drift; they
do not independently prove measurement quality. See the full
[method and reproduction protocol](../research/METHODOLOGY.md).

Independent paired agent tasks are still needed to measure diagnostic quality,
retrieval/repair costs, and end-to-end token usage. CI polling is not included:
call frequency alone does not show a benefit over native `gh run watch`.
