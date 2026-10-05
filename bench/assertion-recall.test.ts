import { expect, test } from "bun:test";
import { sweep, qualifyingCallbacks, removeLine } from "./assertion-recall";

const file = (...lines: string[]) => lines.join("\n");

test("qualifies a flat callback and records its single-line expects", () => {
  const text = file(
    'test("parses", () => {',
    "  const m = parse(x);",
    "  expect(m.key).toBe(1);",
    "});",
  );
  const [cb] = qualifyingCallbacks(text);
  expect(cb?.expects).toEqual([2]);
  expect(removeLine(text, 2)).toBe(file('test("parses", () => {', "  const m = parse(x);", "});"));
});

test("rejects callbacks with other checks, nested blocks or multi-line expects", () => {
  expect(qualifyingCallbacks(file('test("a", () => {', "  if (!ok) throw new Error();", "  expect(ok).toBe(true);", "});"))).toEqual([]);
  expect(qualifyingCallbacks(file('test("b", () => {', "  for (const x of xs) {", "    expect(x).toBe(1);", "  }", "});"))).toEqual([]);
  expect(qualifyingCallbacks(file('test("c", () => {', "  expect(() => run())", '    .toThrow("no");', "});"))).toEqual([]);
  expect(qualifyingCallbacks(file('test("d", () => {', "  checkShape(x);", "  expect(x).toBe(1);", "});"))).toEqual([]);
  expect(qualifyingCallbacks(file('test("e", async () => {', '  await expectRejectedWith(go(), "no");', "  expect(x).toBe(1);", "});"))).toEqual([]);
});

test("counts every expect in a qualifying near-miss callback", () => {
  const text = file('it("two", async () => {', "  const r = await go();", "  expect(r.a).toBe(1);", "  expect(r.b).toBe(2);", "});");
  expect(qualifyingCallbacks(text)[0]?.expects).toEqual([2, 3]);
});

test("sweep counts a case at a cutoff by its highest score for the rule", () => {
  const f = (score: number) => [{ rule: "core-removed-test-assertions", path: "a.test.ts", score }];
  const rows = sweep({
    v1: { kind: "violation", set: "calibration", findings: f(0.8) },
    v2: { kind: "violation", set: "calibration", findings: f(0.3) },
    n1: { kind: "near-miss", set: "calibration", findings: f(0.5) },
    c1: { kind: "clean", set: "calibration", findings: [] },
    h1: { kind: "violation", set: "heldout", findings: f(0.9) },
  }, "calibration", [0.2, 0.6]);
  expect(rows).toEqual([
    { cutoff: 0.2, recall: "2/2", false_alarms: "1/2" },
    { cutoff: 0.6, recall: "1/2", false_alarms: "0/2" },
  ]);
});
