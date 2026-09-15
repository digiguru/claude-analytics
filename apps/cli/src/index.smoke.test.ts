import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";

// One smoke test confirming the commander wiring itself still works after
// the DI refactor (#37) — every command's own logic is unit-tested via its
// run* function; this only proves index.ts still parses args and dispatches
// correctly as a real subprocess. Not attempting to unit-test commander's
// own argument parsing.
const entry = fileURLToPath(new URL("./index.ts", import.meta.url));

test("group --help prints usage via the real commander wiring", () => {
  const out = execFileSync(process.execPath, ["--import", "tsx", entry, "group", "--help"], {
    encoding: "utf8",
  });
  expect(out).toContain("Aggregate usage/cost/activity");
  expect(out).toContain("--group-by");
});
