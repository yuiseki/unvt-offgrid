import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "e2e/fixtures/kanto-z6.pmtiles";
const FIXTURE_SIZE = statSync(FIXTURE).size;
const FIXTURE_SHA256 = createHash("sha256").update(readFileSync(FIXTURE)).digest("hex");
const ARCHIVE = "kanto-251124.pmtiles";

async function idle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const m = (window as any).offgridMap;
        if (m.loaded() && m.areTilesLoaded()) resolve();
        else m.once("idle", () => resolve());
      }),
  );
}

/** Size and SHA-256 of a file in OPFS regions/, or null. */
async function opfsFile(page: Page, name: string) {
  return page.evaluate(async (name) => {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("regions");
      const file = await (await dir.getFileHandle(name)).getFile();
      const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return { size: file.size, sha256: hex };
    } catch {
      return null;
    }
  }, name);
}

async function downloadKanto(page: Page) {
  await page.goto("./");
  await expect(page.locator("body")).toHaveAttribute("data-node", "world");
  await page.getByRole("button", { name: /^日本/ }).click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "japan");
  await page.getByRole("button", { name: /^関東/ }).click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanto");
  await page.locator("#download").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map", { timeout: 30_000 });
}

test("world > Japan > Kanto, download, then the map opens", async ({ page }) => {
  await downloadKanto(page);
  expect(await opfsFile(page, ARCHIVE)).toEqual({ size: FIXTURE_SIZE, sha256: FIXTURE_SHA256 });
  await idle(page);
  const layers = await page.evaluate(() =>
    [...new Set((window as any).offgridMap.queryRenderedFeatures().map((f: any) => f.sourceLayer))].sort(),
  );
  expect(layers).toContain("water");
  expect(layers).toContain("place");
});
