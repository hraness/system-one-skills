# Unattended discovery month

This runbook defines the month-long local XCB lane for Algal discovery and
skill improvement. The scheduled lane runs until **2026-11-02 UTC**. It is a
sequence of bounded, restartable passes; it is not an always-on autonomous
agent.

## Each wake-up

1. Read the current git state and the last campaign receipt before doing work.
2. Choose one narrow question from `Research/algal-watch` or an open campaign.
3. Capture a small source bundle with provenance and run `research-triage`.
4. Register a hypothesis, controls, a disconfirming test, and a finite budget.
5. Run the smallest useful analysis or counterexample search. Keep failures and
   unresolved tail cases in the campaign record.
6. Run an independent review or clean replay when a candidate survives.
7. Write a dated report and a restartable handoff. A candidate remains a
   candidate until corpus or experiment-level checks certify it.

## Limits and gates

- At most one campaign pass and 24 model calls per wake-up; at most 60 minutes
  of model work. Offline parsing and replay may continue within host limits.
- Never expose protected holdouts, credentials, private source packs, or task
  content. Keep source extracts and receipts local to their owning project.
- Never publish, push, merge, deploy, change a dependency, or promote a model
  or habitat from a scheduled pass. Prepare a reviewable patch or report for a
  later operator turn.
- Habitat evolution may evaluate candidates on labeled development fixtures,
  but promotion requires a strictly better replay score and an intact lineage
  record. A scheduled pass may propose a candidate and record its score only.
- Stop at the deadline, after three non-improving trials for one mechanism, or
  when a provider, budget, data-rights, or evidence gate is unavailable.

## Handoff record

Each pass records its question, source hashes, hypothesis, controls, calls and
elapsed time, result, failures, unresolved tail, next experiment, and receipt
path. Reports should make it possible to resume without trusting an uncertain
provider call or rerunning a completed effect.
