# Result: `core-removed-test-assertions` on realistic diffs (2026-09)

Plan: [ASSERTION-RECALL-PLAN-2026-09.md](ASSERTION-RECALL-PLAN-2026-09.md)
(plan ref `assertion-recall-2026-09`). Cases:
`bench/report/assertion-recall-cases-2026-09.json`. Raw results:
`bench/report/assertion-recall-results-2026-09.json`. Sys1 `d36d8fb`, model
`typesafe/jev-1.13.0`, one `sys1 review checkpoint` per case, rule filter on
the planted file, 314 Jev requests in total.

## Decision

**Inadequate.** Held-out recall is 24% against the plan's 80% bar. The false
alarm bar is met.

| Set | Violations caught | False alarms, near-miss | False alarms, clean |
|---|---|---|---|
| Calibration | 8/30 (27%, 95% CI 14–44%) | 0/30 | 0/30 |
| Held-out | 5/21 (24%, 95% CI 11–45%) | 0/21 | 0/21 |

Combined false alarm rate: 0/60 (CI 0–6%) calibration, 0/42 (CI 0–8%) held-out.

## Notes

- **Misses are model misses.** Of the 38 missed violations, 37 completed with
  every review unit evaluated and no finding of any kind. Jev saw the change
  and returned nothing.
- **One case never reached Jev.** `algal-9a968eda-violation` plants in
  `src/credentials.test.ts`, which Sys1 excludes as sensitive by design
  (`excluded_sensitive`). Per the plan it counts as a miss; excluding it,
  calibration recall is 8/29 (28%).
- **The earlier 3/8 was mostly a test problem.** Re-reading the eight
  removed-assertion plants from the review benchmarks against the rule's
  wording, four were not violations (another check remained, or a chained
  `.toThrow` was split). The generator here excludes those shapes, and an
  independent pass over all 102 violation and near-miss cases found one
  mislabel (a callback still calling an `expectRejectedWith` helper); the
  filter was fixed and the set regenerated before any Jev call.
- **The rule is precise but does not fire.** Zero false alarms on 102
  near-miss and clean cases, including 51 that remove an `expect` while
  another remains, means Jev does distinguish the cases; it is simply
  conservative on violations.

## Next

Per the plan, any rule change is tuned on the calibration set only and then
scored once on held-out. A detector is not an option for this rule: whether a
remaining call still asserts behavior needs judgment. The cheapest candidates
are rule wording and examples that show the exact shape (the last `expect` in
a callback deleted), then a Jev model or prompt change if wording does not
move calibration recall.
