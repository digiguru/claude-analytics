import { test, expect } from "@playwright/test";

/**
 * Browser smoke test (#38): boots the real server (webServer config, seeded
 * via e2e/seed-server.ts) and a real Chromium page, proving the one thing no
 * amount of jsdom/component testing can — that the app mounts, its numbers
 * are real (not $NaN, the #21 regression), and a chart actually renders SVG
 * output in a real browser (proving the recharts 2→3 migration from #14
 * didn't silently break).
 */
test("the app mounts, shows real overview numbers, and Groups renders a chart", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("/");
  await expect(page.getByText("Claude Analytics Explorer")).toBeVisible();

  // Overview numbers render for real, not $NaN — regression check for #21's
  // NaN-guard fix.
  const statGrid = page.locator(".stat-grid");
  await expect(statGrid).toContainText("$");
  await expect(statGrid).not.toContainText("NaN");

  // Overview's charts are lazy-loaded (recharts is ~60% of the build and is
  // kept off the initial chunk), so this also proves that dynamic import
  // resolves — the stat grid above renders without it and would pass alone.
  await expect(page.locator(".recharts-surface").first()).toBeVisible();

  await page.getByRole("button", { name: "Groups & products" }).click();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

/**
 * The totals chart's "Breakdown by" stacking. Worth a browser test rather than
 * only jsdom: under jsdom recharts renders the layer structure but no rect
 * geometry and no <LabelList> text at all, so the per-group total label above
 * each stack — and the fact that the segments really are stacked — can only be
 * proven here.
 */
test("Groups: Breakdown by stacks the totals chart and still drives the table's drill-down", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Groups & products" }).click();

  // Seeded (e2e/seed-server.ts): Level Senior = Engineer $12.34 + Designer
  // $5.00, Level Junior = Engineer $20.00. "Stacking by" auto-selects the
  // first CSV column, which parseAttributesCsv orders as Level.
  await expect(page.getByRole("heading", { name: "Total cost by Level" })).toBeVisible();
  // The totals chart is the only one on this tab with a <LabelList>, so its
  // per-group total labels are addressable without depending on DOM order.
  const totalLabels = page.locator(".recharts-label-list");
  await expect(totalLabels.filter({ hasText: "$17.34" })).toHaveCount(1); // Senior
  await expect(totalLabels.filter({ hasText: "$20.00" })).toHaveCount(1); // Junior

  // The label/select pairs are adjacent siblings, not htmlFor-associated — and
  // "Quick filter by" also offers a "None", so pick this one by its own label.
  await page.getByText("Breakdown by", { exact: true }).locator("xpath=following-sibling::select").selectOption("Role");

  // Same metric, same bar heights, now split into one coloured series per Role.
  await expect(page.getByRole("heading", { name: "Total cost by Level, split by Role" })).toBeVisible();
  const legend = page.locator(".recharts-legend-wrapper").last();
  await expect(legend).toContainText("Engineer");
  await expect(legend).toContainText("Designer");
  // Two <Bar> series (Engineer, Designer) rather than the single-colour one.
  expect(await page.locator(".recharts-bar").count()).toBeGreaterThan(3);
  // Every group still gets exactly one label, reporting the metric rather than
  // a segment: Senior is still $17.34 even though its largest segment is
  // $12.34, and Junior — which has nothing at all in the topmost series — is
  // still labelled rather than silently losing its total.
  await expect(totalLabels.filter({ hasText: "$17.34" })).toHaveCount(1);
  await expect(totalLabels.filter({ hasText: "$20.00" })).toHaveCount(1);

  // ...and the same pick still expands the table below.
  await expect(page.getByText("Expand a row below to see its breakdown by Role")).toBeVisible();
  await page
    .getByRole("row", { name: /Senior/ })
    .first()
    .click();
  await expect(page.getByText("Breakdown by Role:")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
