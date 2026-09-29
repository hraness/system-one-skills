# Tuning plan: `core-removed-test-assertions` (2026-09)

Plan ref: `assertion-tuning-2026-09`. Written before any tuning run. Follows the
[recall result](ASSERTION-RECALL-RESULT-2026-09.md): held-out recall 5/21 (24%),
no false alarms. Cases are unchanged:
`bench/report/assertion-recall-cases-2026-09.json`.

## Hypotheses

1. **Cutoff.** Sys1 drops any answer scoring below the rule's `medium` tier
   (0.7) without recording it. Jev may lean toward "violation" on many misses
   at a score under 0.7.
2. **Wording.** The `breaks` sentence requires "no ... possible replacement
   assertion helper call afterward". Nearly every test callback still calls
   some function (setup, the code under test, cleanup), so a literal reading
   excuses almost every violation.

## Variants

Each variant is run on the **calibration set only** (90 cases), with the rule's
`medium` tier lowered to 0.01 in a scratch Sys1 checkout so every answer's score
is recorded. Nothing else in Sys1 changes.

- **V0**: the current wording. Measures hypothesis 1.
- **V1**: rewritten wording (below). Measures hypothesis 2.
- **V2**, only if V1 misses the bar on calibration: V1 plus one short worked
  example of each outcome in the `ensure` text. Written after V1's result and
  added to this file before it runs.

V0 and V1 are scratch Sys1 branches off `main` `d36d8fb` (`tune/assertion-v0`
`8868f5c`, `tune/assertion-v1` `3b0cc18`, local only), changing only this rule's
wording and tier. No more than these three are run. For each variant and each cutoff `t` in
{0.1, 0.2, ..., 0.9}, calibration recall and false alarm rate are computed from
the recorded scores.

## Selection and held-out score

The selected configuration is the variant and cutoff with the highest
calibration recall whose calibration false alarm rate (near-miss and clean
combined, 60 cases) is at most 5%; ties go to the higher cutoff, then to the
earlier variant. It is then run **once** on the held-out set (63 cases) at its
real cutoff, with `high` unchanged unless the cutoff exceeds it.

The decision uses the recall plan's bar: held-out recall at least 80% and
held-out false alarm rate at most 5%. If that passes, the wording and cutoff go
to Sys1 as a pack change. If it fails, the result is recorded and the rule
stays as it is; further gains would need a Jev model or prompt change.

## V1 wording

`ensure`:

> The change does not leave a retained JavaScript or TypeScript test callback
> with no behavioral assertion. It breaks this rule when the diff deletes an
> executable expect(...) matcher, assert call, or explicit throw-on-failure
> check from a test callback that is still present after the change, and that
> callback, as shown after the change, has no remaining expect(...) matcher,
> assert call, throw-on-failure check, call to a helper named expect*,
> assert*, check*, verify*, ensure* or must*, or newly added call. Setup,
> calls to the code under test, cleanup, logging, comments,
> expect.assertions and expect.hasAssertions are not behavioral assertions.
> Deleting a whole test, or deleting one assertion while another remains,
> satisfies this rule. If the start or end of the callback is not shown, the
> rule is satisfied.

`breaks`:

> A test callback that is still present lost its last expect, assert or
> throw-on-failure check in this diff, and after the change it only sets up,
> calls code or cleans up, with no assertion and no assertion-named or newly
> added helper call left.
