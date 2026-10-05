# All skills: shipped capability and research candidates

**One skill is installed: `system-one-verify`. Ten other names are research candidates, not available commands or installed instructions.** Keeping the complete catalog visible makes the work inspectable without charging every agent for unproven skills.

“Provably good” needs a bounded claim: a defined task, the best practical native baseline, a frozen implementation, an independent correctness check, and measured total cost. A small output or valid JSON schema alone proves neither better reliability nor faster completion. No skill currently has a demonstrated end-to-end improvement across all three dimensions.

## What earns a place in your agent

The shipped skill has one measured benefit: **smaller noisy check results**.
Across 563 real validation outputs, it presented **35.20% less UTF-8 text**
(32.65% Codex, 38.90% Devin; Claude had no qualifying outputs) with zero
replay-preservation failures. The 28 outputs that crossed the compaction guard
were 90.61% smaller. These are text-size results, not provider-native token
or complete-task savings. The full denominator and the explicit “no numeric
result” status for every other name are in the [numeric scorecard](SCORECARD.md).
Running the command once and retaining its exit status and private log are
tested behaviors. Faster tasks and better diagnoses require separate evidence.
Research candidates do not add instructions to your agent until they justify
their cost.

| Skill | Intended benefit | Evidence and current decision |
| --- | --- | --- |
| `system-one-verify` | Read less repetitive test output | **Shipped for known noisy checks.** 35.20% less presented text across 563 real outputs, with 0 preservation failures; 90.61% on the 28 outputs compacted. No whole-task provider-token percentage is established. [Scorecard](SCORECARD.md) · [Replay](RESULTS.md). |
| `system-one-explore` | Find matching code and relevant source lines in one result | **Research only.** Many existing search results are small; must beat focused native search plus context lines while preserving required locations. [Cost screen](CANDIDATE-EVIDENCE.md). |
| `system-one-ci` | Avoid unnecessary model turns while CI runs | **Use native watching.** The identity pilot showed no benefit; avoidable polling and token savings were not measured. [Pilot](CI-PILOT.md). |
| `system-one-digest` | Inspect repository state in one concise result | **Deferred; use native Git.** Small native outputs leave little room for another layer to help. [Cost screen](CANDIDATE-EVIDENCE.md). |
| `system-one-diff` | Review relevant changes without losing coverage | **Research only.** Some outputs have room for reduction; retained review coverage is untested. [Cost screen](CANDIDATE-EVIDENCE.md). |
| `system-one-fetch` | Read the relevant parts of a web page | **Deferred; use the existing reader.** Must preserve needed evidence and beat targeted source reading. [Cost screen](CANDIDATE-EVIDENCE.md). |
| `system-one-research` | Assemble source evidence with fewer repeated reads | **Deferred.** No independently demonstrated benefit distinct from source extraction and retrieval. |
| `system-one-triage` | Resolve bounded decisions without unnecessary reasoning | **Deferred.** Needs a specific labeled decision family and comparison with deterministic rules. |
| `system-one-writing` | Catch mechanical draft issues before semantic review | **Inactive.** No suitable writing-task evaluation cohort; use existing linters. |
| `system-one-evolve` | Improve a recurring routing policy over time | **Internal research only.** First needs a useful fixed policy; optimization must repay its own evaluation cost. |
| `system-one` | Select the smallest useful skill | **Inactive.** One shipped skill does not justify an extra routing layer. |

Each contract below specifies what correctness means and what tokens and time
must be measured. A missing measurement is an evidence gap, not zero cost or an
implied benefit. No research candidate currently has demonstrated task-level
token, reliability, or speed improvements.

The earlier three-log development result uses `o200k_base`, not provider billing. Those three logs are successful Devin checks; 21 short examples would cost more if the skill were invoked. The separate [failure audit](FAILURE-EVIDENCE.md) adds one Devin example. Those earlier development windows yielded no qualifying noisy Codex or Claude replay samples; the broader replay summarized above includes Codex. The [per-case results and limitations](METRICS.md) retain the original development measurements.

The separate [runtime measurement](RUNTIME-EVIDENCE.md) used seven synthetic fixtures shaped by public transcript sizes, not the historical project commands: **140 measured pairs and 14 excluded warmup pairs** on macOS arm64 with Node 24.20.0. Median wrapper overhead was **41.82 ms**, with **48.37 ms p95**. Every measured/warmup pair preserved exit, full log and single execution; the runtime suite passed 25 tests and 125 assertions. These checks establish their specific contracts, not better agent reliability. The added local cost is not a measured task speedup, and the shared-host timing is not a performance guarantee.

## What the earlier discovery cohorts show

The two disjoint cohorts cover September 12–19, 2026, ending at 14:00 UTC on September 19. They contain **7,807 observed model-visible calls** from one consenting developer: **229 Codex, 32 Claude Code, and 7,546 Devin CLI**. These are observed retained records, not a representative agent benchmark. Empty categories mean no records matched the analyzer in this corpus, not that the agent never does that work.

| Workflow category | Codex calls | Claude calls | Devin calls | Total calls | Output bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| validation | 0 | 0 | 283 | 283 | 519,516 |
| repository search | 18 | 3 | 552 | 573 | 1,048,645 |
| git state | 7 | 0 | 217 | 224 | 131,325 |
| diff review | 1 | 0 | 67 | 68 | 286,372 |
| ci status | 0 | 0 | 128 | 128 | 257,030 |
| web research | 0 | 0 | 95 | 95 | 391,519 |
| file read | 42 | 9 | 1,149 | 1,200 | 4,142,386 |

The table is a subset of the corpus categories. **Bytes are not tokens, and repeated workflow labels do not establish repeated work.** A search may already be optimally scoped; a CI status check may be the only check of that run. Generic file reads, process waits, edits and coordination are not relabeled as candidate use cases without inspecting their meaning.

The **150 nested Codex completed-command events** form a separate overlapping telemetry view. They are not added to the call or byte totals above. Fetch and research share the same web-research proxy; triage overlaps diff/research; per-skill totals must not be added together. Provider usage counters, cached tokens and session groups also have different semantics and are not pooled into a claimed saving.

The machine-readable [portfolio report](../research/portfolio-report.json) includes every workflow category, zeros for all three providers, report hashes, the complete 11-name inventory provenance, and an experiment specification for every candidate. It derives from [the first cohort](../research/session-report.json) and [the supplemental cohort](../research/supplemental-session-report.json). The [collection method](../research/METHODOLOGY.md) explains selection and deduplication.

## Next experiments

1. **Make failure results more useful (`system-one-verify`).** The [failed-check replay](FAILURE-EVIDENCE.md) retained seven failure identities and their common error but omitted six of seven distinct call sites. The [one live diagnosis pair](DIAGNOSIS-RESULTS.md) needed four reads with the summary versus three with native targeted reads; it does not establish that any particular omission caused the extra read. Test an exact failure manifest with grouped errors, every reported source location and a full-log line index. Unsupported formats must fall back visibly. Compare against native failure reporters and targeted log reads; shorter output alone cannot qualify it.
2. **Native quiet output before another wrapper.** Current Bun `--dots` removed 88% of output plus invocation text in one passing fixture without skill overhead. This [native control](CANDIDATE-EVIDENCE.md) is a practical starting point, not an additional skill or proof about historical projects. A future integration must preserve the requested test selection, failure evidence and required warnings for the specific runner/version. Do not silently add reporter flags to a user's command.
3. **Search with the needed source lines (`system-one-explore`).** 573 searches appear across all three providers. Test a focused query and relevant excerpts together against native search with context, path/glob limits and targeted reads. Freeze the required answer locations and account for all pagination and follow-up reads; most current outputs have too little text to justify a generic compression layer. Preserve total-match and coverage information instead of silently clipping.

Large-diff coverage remains a secondary research direction. Native run watching
is the current answer for CI: the [completed identity pilot](CI-PILOT.md) resolved
32 of 128 calls into 30 run/context groups and did not measure avoidable polling.
Generic Git summaries, source bundling and typed routing need a demonstrated
task before implementation. Writing, policy evolution and umbrella routing stay
outside the active product roadmap.

**New class screened: unchanged-read reuse.** A separate local analysis of the
1,200 file reads found 74 exact same-session/query/output repeats, representing
only 1.09% of read-output tokens before any reuse cost. The sole repeat with no
intervening observed call contained two tokens. These observations cannot
establish freshness or whether prior evidence remained in context. They do not
justify an installed caching skill or elevating it above the priorities above.
The same bounded screen found no complete JSON container eligible for its
field-projection format check; that says nothing about formats it did not parse.
[Method, provider counts and negative findings](CANDIDATE-OPPORTUNITIES.md).

These are research priorities, not additions to the installed package. Validation also needs new held-out tasks, especially long failures and Codex/Claude coverage. No broader rollout should follow from these aggregate counts alone. The bounded experiments below are **discovery pilots**, not qualification cohorts: proposed 10-, 12-, or 20-task samples do not satisfy the [whole-task assessment](../bench/TRIALS.md), which requires at least 30 independently audited task/session clusters within each declared provider/model scope, plus its other correctness and accounting gates.

## Skill contracts and research plan

### system-one-verify

**Shipped, for known noisy validation.** Corpus proxy: validation; Codex / Claude / Devin calls = 0 / 0 / 283. Validation-class calls are a workflow proxy; only completed explicit-exit outputs qualify for replay. Dependency/build and mixed-shell calls are not silently reclassified.

**Proposed value:** Run one known noisy validation command once; show a compact exit-status report and relevant excerpt, retain the full private local log, and disclose omissions. Fewer model-visible log tokens are the measured mechanism; better diagnosis and faster tasks remain hypotheses.

**Native baseline:** Run the same command with the project-supported quiet or summary reporter when it preserves required evidence; otherwise use the native execution tool with a saved log and targeted reads.

**Correctness contract:** Execute the authorized command only once. Preserve the child exit status and distinguish wrapper timeouts, cancellation, spawn errors and logging limits. Pass short output through exactly; disclose omitted bytes and incomplete capture. Keep the complete local log unless a disclosed resource failure prevents it; never treat an excerpt as diagnostic completeness.

**Completed diagnosis evidence:** In one fixed-order live Codex pair on a historical Devin failure, observed input + output usage fell from 49,803 to 47,840 (3.9%), both answers scored 6/6 on a blinded rubric, and launcher duration rose from 28.625 to 37.974 seconds. Four reads versus three and uncontrolled cache effects limit the inference. This is a single exploratory case, not a held-out qualification or a reliability improvement. Failed setup costs remain recorded in [the complete results](DIAGNOSIS-RESULTS.md).

**Still to measure:** Tokens — Held-out complete agent tasks, native quiet-reporter baseline, skill discovery/loading interactions, controlled cache effects and every follow-up read or repair. Reliability — Independent task success and failure diagnosis on new long failing logs; selection accuracy and next-run verbosity stability across all three agents. Performance — Repeated paired whole-agent task duration, tool/model-call count and time to a correct diagnosis, including follow-up reads. Local synthetic CLI overhead is measured separately; no end-to-end speedup is demonstrated.

**Next experiment:** Freeze the current implementation and a prior-observation routing rule; pre-register 12 new paired noisy-check tasks, balanced successful and failing outcomes when authorized data permits. Compare native best-practice and skill arms on identical repository states; blind-score exit interpretation and diagnosis; count all text, retrievals, repairs and elapsed time. Report missing provider strata without substitutions.

### system-one-explore

**Research candidate; not installed.** Corpus proxy: repository search; Codex / Claude / Devin calls = 18 / 3 / 552. Search calls across all three providers motivate a bounded-search experiment. The category does not establish redundant search, excessive output, or adequate answer coverage.

**Proposed value:** Return a bounded repository inventory or search result with file/line provenance, counts and explicit truncation; potentially combine repeated discovery reads. The narrower first experiment is exact search-result retrieval, not general repository understanding.

**Native baseline:** Use native repository search with a focused path/glob and bounded matches, then read only relevant lines; reuse a repository map when one exists.

**Correctness contract:** Preserve query syntax, exit/error distinction, path and line identities. Disclose ignored files, truncation and match-count limits; never equate a bounded result with no other matches. Preserve an explicit next page or native fallback for necessary missing matches.

**Still to measure:** Tokens — Actual query-to-answer paired cases and full routing/discovery/pagination overhead; fewer visible bytes alone do not show lower task tokens. Reliability — Answer completeness versus all expected matching locations, including ignored files, multiple languages and matches beyond the first page. Performance — Search runtime and time to correct location compared with one well-scoped native search; setup must not dominate short queries.

**Next experiment:** Pre-register 20 authorized real location-finding tasks from all represented provider strata where available. Freeze repository snapshots and answer-location sets. Compare a focused native search against one bounded-result prototype; include empty results, invalid patterns and matches beyond the cap. Require correct locations and count follow-up reads plus elapsed time.

### system-one-ci

**Pilot result:** The [CI identity pilot](CI-PILOT.md) recovered the same 128-call count in a fresh active-ancestry snapshot. Of 32 identity-resolved calls, four formed two repeated groups; the remaining 96 calls were unresolved. Different literal queries and absent parsed states prevent a redundancy claim. [Report](../research/ci-pilot-report.json): no measured avoidable turns, token saving, latency change or reliability improvement.

**Research candidate; not installed.** Corpus proxy: ci status; Codex / Claude / Devin calls = 0 / 0 / 128. CI-status calls motivate identity-linked analysis only. Aggregates do not reveal repeated polling of the same run; generic process waits are excluded.

**Proposed value:** Resolve one exact CI run and wait locally, returning run identity, commit, terminal conclusion or an explicit bounded timeout; potentially avoid repeated model turns for unchanged status.

**Native baseline:** Use the provider CLI native run-watch operation for an explicit run ID, preserving the exit result; use a focused status query when waiting is unnecessary.

**Correctness contract:** Pin the run ID and expected commit; never switch to a newer run silently. Distinguish missing run, permission/API failure, nonterminal timeout, cancelled result and terminal success. Do not treat one successful run as every required repository check passing.

**Still to measure:** Tokens — Identity-linked real polling sequences and paired full-task usage versus native run-watch; status-call frequency alone is insufficient. Reliability — Exact-run/commit correctness through concurrent new runs, reruns, API failures and timeouts; required-check completeness remains a caller responsibility. Performance — End-to-end wait time, API request count, model turns and terminal-state detection delay versus the native watch interval.

**Next experiment:** First privately annotate at most 20 CI-status sequences with opaque same-run identities. Proceed only if redundant model polling is observed. Replay recorded status transitions in a deterministic fixture against a native-watch baseline; include rerun, missing run and nonterminal timeout cases. Do not claim live-provider latency from the replay.

### system-one-digest

**Research candidate; not installed.** Corpus proxy: git state; Codex / Claude / Devin calls = 7 / 0 / 217. Git-state calls are counted; aggregate records do not show that all proposed digest fields were needed together.

**Proposed value:** Collect only requested repository-state fields in one compact report; potentially avoid multiple model/tool round trips.

**Native baseline:** Use native machine-readable git status for current state, adding focused log or diff-stat queries only when the task requires them.

**Correctness contract:** Distinguish staged, unstaged, untracked and conflicted state. Preserve repository/branch/commit identity and ahead/behind semantics; disclose missing upstream or unborn branch. Avoid implying atomic consistency if the repository changes between reads.

**Still to measure:** Tokens — Paired tasks showing a digest beats a single concise native status query after skill overhead; small outputs may become more expensive. Reliability — State accuracy with detached HEAD, conflicts, missing upstream, unusual filenames and concurrent changes. Performance — Subprocess startup and report time versus the minimal native query, plus any avoided model turns.

**Next experiment:** Select 12 real state-inspection tasks with a declared required-field set. Replay frozen repository fixtures, including dirty and conflicted states. Compare exactly required fields against native porcelain output and count full-task tokens and time before considering installation.

### system-one-diff

**Research candidate; not installed.** Corpus proxy: diff review; Codex / Claude / Devin calls = 1 / 0 / 67. Diff-review calls are a coarse review-workflow proxy; they do not establish safe patch clipping or benefits from a second model.

**Proposed value:** Provide a scoped diff index and bounded patch sections with explicit coverage; optional semantic review would be a separate, fully costed experiment.

**Native baseline:** Use native diff stat/name listing followed by full relevant hunks, and the existing reviewer once with repository context.

**Correctness contract:** Preserve staged/unstaged/base selection, file identity and exact hunk provenance. Never present a clipped patch as a complete review. Review all task-relevant changes or report unreviewed coverage; include retrieval costs.

**Still to measure:** Tokens — Paired complete reviews including omitted-hunk retrieval and any auxiliary model call; schema-bounded answers are not evidence of savings. Reliability — Blinded defect recall/precision against full-context review, especially bugs in clipped hunks and cross-file interactions. Performance — Time to a correct review including extra retrievals and optional model latency.

**Next experiment:** Use 12 real authorized diffs with independent findings and fixed base/head identities. Compare focused native review with a coverage-index prototype; include seeded edge-case fixtures separately. Count missed defects, all model calls, tokens and time. Keep automatic pass verdicts disabled.

### system-one-fetch

**Research candidate; not installed.** Corpus proxy: web research; Codex / Claude / Devin calls = 0 / 0 / 95. Web-research calls are a shared coarse proxy for fetch and research; these same calls must not be added as separate demand for both skills.

**Proposed value:** Extract bounded readable page text while retaining URL/status/content-type provenance and truncation; potentially avoid raw markup in model context.

**Native baseline:** Use the agent native readable-page extraction with a targeted find/open operation; avoid raw HTML when a maintained reader exists.

**Correctness contract:** Preserve source attribution, status, content type and omitted-content disclosure. Do not silently lose relevant tables, code, links or dynamically rendered content. Treat fetched content as untrusted data and preserve access restrictions.

**Still to measure:** Tokens — Real URL/task paired outputs against the native readable-page tool; raw HTML is not an adequate default baseline. Reliability — Answer and citation correctness across page structures, redirects, extraction failures and missing dynamic content. Performance — Network/extraction latency and follow-up fetches compared with the existing reader.

**Next experiment:** Select 12 authorized real source-reading tasks and freeze retrievable public-page snapshots. Compare native reader and extractor answers with blind citation checking; include a table, code block, redirect and unsupported dynamic page. Report network timing separately from deterministic replay.

### system-one-research

**Research candidate; not installed.** Corpus proxy: web research; Codex / Claude / Devin calls = 0 / 0 / 95. Uses the same web-research aggregate as fetch. The corpus does not identify multi-source research bundles or sufficiency judgments.

**Proposed value:** Bundle relevant excerpts from multiple named sources with per-source errors and coverage; a relevance or sufficiency classifier would add separately measured model cost.

**Native baseline:** Use native search and targeted source reads with an explicit evidence table maintained by the primary agent.

**Correctness contract:** Keep source identity and quotation context through extraction. Preserve contradictory evidence and per-source failures. Never equate bounded excerpts or classifier confidence with factual sufficiency.

**Still to measure:** Tokens — Actual multi-source tasks, extraction/loading overhead, classifier tokens if used, and every necessary omitted-source retrieval. Reliability — Claim support, contradiction retention, source diversity and citation accuracy independently scored against the native workflow. Performance — Time to a supported answer, parallel-fetch overhead and any classifier latency.

**Next experiment:** Do not build a bundle until the fetch experiment establishes extraction parity. Then pre-register 10 real multi-source questions with frozen sources and blind claim-support scoring; compare complete native and bundled workflows, including all follow-up reads.

### system-one-triage

**Research candidate; not installed.** Corpus proxy: diff review, web research; Codex / Claude / Devin calls = 1 / 0 / 162. Related categories only, not observed triage use. No typed-decision task or ground-truth label is identified; counts overlap diff, fetch and research.

**Proposed value:** A small typed classifier could route a clearly defined decision to a cheaper process, with abstention for uncertainty; structured output alone does not make judgments accurate.

**Native baseline:** Use deterministic repository gates for objective decisions and the primary agent with the same evidence for judgments; avoid an extra model call without demonstrated benefit.

**Correctness contract:** Preserve evidence and uncertainty; abstain rather than invent missing facts. Never use uncalibrated confidence as authorization to merge, publish or skip checks. Separate schema validity from semantic correctness and include the cost of mistakes.

**Still to measure:** Tokens — A concrete labeled decision family, all classifier and escalation costs, and comparison against deterministic/native alternatives. Reliability — Held-out decision accuracy, calibration, false-negative impact and abstention coverage, stratified by decision type. Performance — Model/service latency, fallback latency and end-to-end task duration; external calls can make the task slower.

**Next experiment:** First define one transcript-grounded decision family and label 30 authorized cases with independent adjudication. Freeze a held-out split before implementation. Compare deterministic rules and the primary-agent baseline; add a classifier only if there is a measured gap, with a mandatory abstain path.

### system-one-writing

**Research candidate; not installed.** Corpus proxy: no dedicated category; Codex / Claude / Devin calls = 0 / 0 / 0. No dedicated writing-workflow label exists in the current reports. File reads and edits cannot be assumed to be draft audits.

**Proposed value:** Surface exact mechanical draft issues such as placeholders or repeated phrases with offsets, leaving semantic editing to a reader; an optional quality judge would incur extra model cost.

**Native baseline:** Use an existing text linter or a focused native search for the named issue, then read the affected prose.

**Correctness contract:** Preserve exact text locations and context; label heuristics as suggestions. Do not infer truth, quality or readiness from readability scores or passive-voice markers. Retain intentional repetition, quotations and domain terminology unless the task requests change.

**Still to measure:** Tokens — Real writing-task corpus, issue prevalence, lint false positives, instruction overhead and semantic follow-up costs. Reliability — Human-adjudicated useful findings versus false positives and missed issues; no workflow-specific evidence is available. Performance — Audit and editing time versus a focused linter/search; no measured speedup.

**Next experiment:** Wait for an authorized writing cohort. Label 12 real draft-audit tasks and required mechanical issues before building a prototype; compare an existing linter and focused native search, reporting false positives, editing outcomes, tokens and time.

### system-one-evolve

**Research candidate; not installed.** Corpus proxy: no dedicated category; Codex / Claude / Devin calls = 0 / 0 / 0. No observed router-evolution workflow or fitness/holdout evidence is identified. Coordination counts are not a proxy for optimization efficacy.

**Proposed value:** Search over candidate routing policies with recorded lineage and deterministic evaluation; optimization may amortize future cost only if held-out performance persists.

**Native baseline:** Use a fixed, reviewed routing rule and a static evaluation set before running any optimization loop.

**Correctness contract:** Keep an untouched holdout and prevent training/evaluation leakage. Count every search, scoring and validation call, including rejected candidates. Promote only after independent correctness and cost gates; retain rollback and do not treat training fitness as deployment proof.

**Still to measure:** Tokens — A transcript-grounded routing task, optimization cost, held-out benefit and sufficient future use to repay search overhead. Reliability — Independent generalization, leakage resistance, stability and regression detection; none is demonstrated by current corpus counts. Performance — Search/evaluation time plus deployment latency; optimization overhead may outweigh all recurring savings.

**Next experiment:** Defer until a fixed router has real labeled tasks and a paired baseline. Pre-register a finite search budget and untouched holdout; compare total training-plus-use cost over an explicit usage horizon, publishing every rejected candidate and regression.

### system-one

**Research candidate; not installed.** Corpus proxy: no dedicated category; Codex / Claude / Devin calls = 0 / 0 / 0. An umbrella router has no independent observed workflow in these reports. Summing the other candidate categories would double count overlapping uses.

**Proposed value:** Select the smallest applicable skill or native tool; could reduce wrong-skill invocation but also adds catalog and routing overhead.

**Native baseline:** Expose only the relevant small skill description and let the primary agent choose native tools directly.

**Correctness contract:** Allow no-skill and abstain outcomes. Preserve skill-specific preconditions and route ambiguous or unsupported work to the native tool. Do not load unrelated skill bodies or imply that all catalog entries are installed.

**Still to measure:** Tokens — Measured selection accuracy and catalog-loading cost versus the current one-skill setup; no independent saving is established. Reliability — False activations, missed useful activations and correct no-skill decisions on held-out agent tasks. Performance — Routing latency and model turns versus direct invocation.

**Next experiment:** Defer until at least two independently admitted skills exist. Then use 20 held-out real task prompts with useful-skill or native-only labels; compare direct descriptions against an umbrella router and include its entire always-visible footprint.

## Admission and continued improvement

An experiment must publish its frozen selection rule, baseline, source revision, sample coverage, all outcomes including negative results, and three separate measurements:

- **Tokens:** total task usage, including always-visible discovery text, loaded instructions, every model call, tool output, follow-up read, retry and repair. Report provider-native usage separately from a named text-token encoding.
- **Reliability:** independent task success or domain-specific correctness, with explicit preservation invariants, missed failures and false positives. A zero-failure small sample is not a universal guarantee.
- **Performance:** elapsed time to a correct outcome, tool/model calls and relevant resource use. Compact output does not establish faster execution.

Choose the native baseline and acceptance margins before observing outcomes. Split development examples from held-out cases before tuning. Evaluate representative failure modes and the no-skill route, including short or already compact native output. A skill should remain research-only if it fails its correctness contract, does not clear its declared total-token margin, or has unaccepted latency regressions. Improvement claims must state which dimension was actually measured; a faster but less reliable result does not pass.

Publish a fresh scorecard when evidence changes. Freeze and reevaluate the affected contract when instructions, routing, runtime or baselines change. Preserve counterexamples and failed experiments so that a better-looking number cannot erase known limits. Public artifacts contain aggregates and opaque source hashes; authorized raw transcripts remain private.
