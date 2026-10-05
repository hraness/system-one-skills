import { expect, test } from "bun:test";
import { emptyCatch } from "./claude-code-review-tasks";

test("emptyCatch skips comment-only catches and empties the first one with code", () => {
  const text = [
    "try { a(); } catch {",
    "  // Continue past absent PATH candidates.",
    "}",
    "try { b(); } catch (error) {",
    "  log(error);",
    "}",
  ].join("\n");
  expect(emptyCatch(text)).toBe([
    "try { a(); } catch {",
    "  // Continue past absent PATH candidates.",
    "}",
    "try { b(); } catch (error) {",
    "}",
  ].join("\n"));
});

test("emptyCatch plants nothing when every catch is already empty of code", () => {
  expect(emptyCatch("try { a(); } catch {\n  /* ignored */\n}\n")).toBeNull();
});
