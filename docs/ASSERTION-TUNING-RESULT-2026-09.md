# Result: tuning `core-removed-test-assertions` (2026-09)

Plan: [ASSERTION-TUNING-PLAN-2026-09.md](ASSERTION-TUNING-PLAN-2026-09.md).
Baseline: [ASSERTION-RECALL-RESULT-2026-09.md](ASSERTION-RECALL-RESULT-2026-09.md).

## Outcome

The selected configuration, **current wording with the `medium` cutoff lowered
from 0.7 to 0.2**, passes the pre-registered bar on the held-out set:

| Held-out (63 cases) | Result | Bar |
|---|---:|---:|
| Recall | 20/21 (95%, 95% CI 77–99%) | ≥ 80% |
| False alarms (near-miss + clean) | 0/42 (0%, 95% CI 0–8%) | ≤ 5% |

The baseline at the 0.7 cutoff caught 5/21 on the same held-out cases. The
wording was not the problem: Jev already separated violations from near misses,
but scored most violations between 0.5 and 0.8, and the cutoff discarded them.

The one held-out miss (`peopleblade-d6b67124-violation`) is a review that sent
one request and got no usable answer back (`incomplete`, 0 of 2 units
evaluated). Per the plan it counts as a miss and was not retried.

## Calibration (90 cases)

| Cutoff | V0 recall | V0 false alarms | V1 recall | V1 false alarms |
|---:|---:|---:|---:|---:|
| 0.1 | 29/30 | 14/60 | 28/30 | 1/60 |
| 0.2 | 28/30 | 2/60 | 26/30 | 0/60 |
| 0.3 | 27/30 | 1/60 | 26/30 | 0/60 |
| 0.4 | 27/30 | 0/60 | 24/30 | 0/60 |
| 0.5 | 25/30 | 0/60 | 23/30 | 0/60 |
| 0.7 | 9/30 | 0/60 | 11/30 | 0/60 |

V0 at 0.2 and V1 at 0.1 tie at 28/30 within the 5% false alarm limit; the plan's
tie-break (higher cutoff) selects V0 at 0.2. V1's rewritten wording did not
improve recall, so V2 was not run. The selection was committed (`ab6ab5f`)
before the held-out run.

In V1, two clean calibration cases came back `incomplete` on the first pass and
were retried once; both completed. The first attempts are kept under `retried`
in `bench/report/assertion-tuning-v1-2026-09.json`. One calibration miss in
each variant is `credentials.test.ts`, which Sys1 deliberately does not send.

## Caveats

- Held-out recall has a wide interval (21 violations); the lower bound is 77%.
- Cases are single-line assertion deletions planted in real tests from the
  user's repos. Other ways of losing an assertion are not covered.
- A cutoff of 0.2 is close to where false alarms start (0.1 gave 14/60 on V0),
  so a model or prompt change in Jev needs this benchmark rerun.

## Cost

496 Jev requests across V0, V1 and held-out. No Claude usage.

Raw results: `bench/report/assertion-tuning-{v0,v1,heldout}-2026-09.json`.
