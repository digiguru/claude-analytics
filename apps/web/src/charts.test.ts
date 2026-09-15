import { test, expect } from "vitest";
import { wrapLabel, xAxisProps } from "./charts.js";

// ---- wrapLabel ----

test("wrapLabel: short text fits on one line", () => {
  expect(wrapLabel("Acme", 16, 4)).toEqual(["Acme"]);
});

test("wrapLabel: greedily packs words onto lines no longer than maxChars", () => {
  expect(wrapLabel("Flow Team One Chatbot", 10, 4)).toEqual(["Flow Team", "One", "Chatbot"]);
});

test("wrapLabel: overflow past maxLines folds into the last line and ellipsises", () => {
  const lines = wrapLabel("one two three four five six seven eight", 5, 2);
  expect(lines).toHaveLength(2);
  expect(lines[1]!.endsWith("…")).toBe(true);
});

test("wrapLabel: collapses repeated whitespace and ignores empty tokens", () => {
  expect(wrapLabel("  a   b  ", 16, 4)).toEqual(["a b"]);
});

test("wrapLabel: empty input returns an empty array", () => {
  expect(wrapLabel("", 16, 4)).toEqual([]);
});

// ---- xAxisProps ----

test("xAxisProps: few categories lay flat with default interval handling", () => {
  expect(xAxisProps(4, 20)).toEqual({ interval: "preserveStartEnd" });
});

test("xAxisProps: forceAllTicks bypasses the 'few categories' shortcut even with few categories", () => {
  const props = xAxisProps(4, 20, { forceAllTicks: true });
  expect(props.interval).not.toBe("preserveStartEnd");
});

test("xAxisProps: short labels with rotateWhenShort rotate to vertical past the threshold", () => {
  const props = xAxisProps(20, 8, { rotateWhenShort: true });
  expect(props.angle).toBe(-90);
  expect(props.textAnchor).toBe("end");
  expect(props.interval).toBe(0);
});

test("xAxisProps: long labels wrap onto multiple lines with a custom tick renderer", () => {
  const props = xAxisProps(20, 30);
  expect(props.interval).toBe(0);
  expect(typeof props.tick).toBe("function");
  expect(typeof props.height).toBe("number");
});
