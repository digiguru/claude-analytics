import { test, expect } from "vitest";
import { resolveGroupByOrError } from "./groupBy.js";

test("resolveGroupByOrError: a CSV column resolves to a selector", () => {
  const attributes = new Map([["a@x.com", { Role: "Engineer" }]]);
  const result = resolveGroupByOrError(attributes, new Map(), "Role");
  expect("selector" in result && result.selector.id).toBe("Role");
});

test("resolveGroupByOrError: an invalid value lists what's available", () => {
  const attributes = new Map([["a@x.com", { Role: "Engineer" }]]);
  const result = resolveGroupByOrError(attributes, new Map(), "Nope");
  expect(result).toEqual({
    error: 'Invalid --group-by "Nope". Available: @project, @team, @client, @member, Role.',
  });
});

// The timeline facets (@project/@team/@client) and @member are always listed
// as "available" regardless of whether a projects file is loaded, so
// `available` is never actually empty in practice — this exercises the same
// (odd, pre-existing) behaviour the original CLI code had, not a new one.
test("resolveGroupByOrError: nothing loaded at all still lists the always-available facets", () => {
  const result = resolveGroupByOrError(new Map(), new Map(), "Nope");
  expect(result).toEqual({
    error: 'Invalid --group-by "Nope". Available: @project, @team, @client, @member.',
  });
});

test("resolveGroupByOrError: @member always resolves, even with nothing loaded", () => {
  const result = resolveGroupByOrError(new Map(), new Map(), "@member");
  expect("selector" in result && result.selector.id).toBe("@member");
});
