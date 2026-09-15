import { test, expect, beforeEach } from "vitest";
import { readParams, setParam } from "./url.js";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

// ---- readParams ----

test("readParams: reflects the current URL's query string", () => {
  window.history.replaceState(null, "", "/?a=1&b=2");
  const params = readParams();
  expect(params.get("a")).toBe("1");
  expect(params.get("b")).toBe("2");
});

// ---- setParam ----

test("setParam: sets a new param, preserving existing ones", () => {
  window.history.replaceState(null, "", "/?a=1");
  setParam("b", "2", true);
  expect(readParams().get("a")).toBe("1");
  expect(readParams().get("b")).toBe("2");
});

test("setParam: null/empty value deletes the param", () => {
  window.history.replaceState(null, "", "/?a=1&b=2");
  setParam("a", null, true);
  expect(readParams().has("a")).toBe(false);
  expect(readParams().get("b")).toBe("2");
  setParam("b", "", true);
  expect(readParams().has("b")).toBe(false);
});

test("setParam: clearing the last param does not drop a #hash (#30 item 9)", () => {
  window.history.replaceState(null, "", "/?a=1#section");
  setParam("a", null, true);
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("#section");
});

test("setParam: a hash survives when other params remain too", () => {
  window.history.replaceState(null, "", "/?a=1&b=2#section");
  setParam("a", null, true);
  expect(readParams().get("b")).toBe("2");
  expect(window.location.hash).toBe("#section");
});
