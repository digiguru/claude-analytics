import { test, expect, vi } from "vitest";
import { testDb, userDayRow, userProductRow } from "../__tests__/helpers.js";
import { runExport } from "./export.js";

test("runExport: an invalid --group-by errors instead of writing a file", () => {
  const db = testDb();
  try {
    const writeFile = vi.fn();
    const result = runExport(
      { db, attributes: new Map(), memberships: new Map(), warnings: [], writeFile },
      { groupBy: "Nope", out: "/tmp/out.csv" },
    );
    expect(result.code).toBe(1);
    expect(writeFile).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

test("runExport: writes the grouped CSV to the injected writer, not the real filesystem", () => {
  const db = testDb();
  try {
    db.upsertUserProducts([userProductRow({ email: "a@x.com", costCents: 300 })]);
    db.upsertUserDays([userDayRow({ email: "a@x.com" })]);
    const writeFile = vi.fn();
    const result = runExport(
      { db, attributes: new Map(), memberships: new Map(), warnings: [], writeFile },
      { groupBy: "@member", out: "/tmp/out.csv" },
    );
    expect(result.code).toBe(0);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, contents] = writeFile.mock.calls[0]!;
    expect(path).toBe("/tmp/out.csv");
    expect(contents).toContain("a@x.com");
    expect(result.lines).toEqual(["Wrote 1 group(s) to /tmp/out.csv."]);
  } finally {
    db.close();
  }
});
