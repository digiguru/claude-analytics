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

  await page.getByRole("button", { name: "Groups & products" }).click();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
