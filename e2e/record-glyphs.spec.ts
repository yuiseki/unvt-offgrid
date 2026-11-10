/**
 * Not part of the normal run. Records which glyph ranges MapLibre asks for
 * while browsing a real region, to choose GLYPH_RANGES in src/assets.ts.
 *
 *   REGION_FILE=/path/to/kanto-251124.pmtiles RECORD_GLYPHS=1 npx playwright test record-glyphs
 *
 * Writes the ranges to test-results/glyph-ranges.json and screenshots to
 * test-results/glyphs-*.png.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.skip(!process.env.RECORD_GLYPHS, "set RECORD_GLYPHS=1 and REGION_FILE to a real archive");
test.setTimeout(600_000);

const PLACES: [string, number, number][] = [
  ["tokyo-station", 139.767, 35.681],
  ["shinjuku", 139.7, 35.69],
  ["yokohama", 139.638, 35.444],
  ["chiba", 140.123, 35.613],
  ["mito", 140.471, 36.366],
  ["utsunomiya", 139.883, 36.555],
  ["maebashi", 139.061, 36.391],
  ["chichibu", 139.085, 35.992],
  ["izu-oshima", 139.4, 34.75],
  ["chichijima", 142.19, 27.09],
];
const ZOOMS = [8, 11, 13, 15, 17];

test("record glyph ranges", async ({ page, request }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /^日本/ }).click();
  await page.getByRole("button", { name: /^関東/ }).click();
  await page.locator("#download").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map", { timeout: 300_000 });
  // Start from an empty glyph cache so every range used shows up as a request.
  await page.evaluate(async () => {
    const c = await caches.open("offgrid-assets");
    for (const k of await c.keys()) if (k.url.includes("/fonts/")) await c.delete(k);
  });
  // Reload too: glyphs already in MapLibre's memory would not be requested again.
  await request.get("/__log");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map");

  mkdirSync("test-results", { recursive: true });
  for (const [name, lon, lat] of PLACES) {
    for (const zoom of ZOOMS) {
      await page.evaluate(([lon, lat, zoom]) => (window as any).offgridMap.jumpTo({ center: [lon, lat], zoom }), [
        lon,
        lat,
        zoom,
      ]);
      await page.evaluate(
        () =>
          new Promise<void>((r) => {
            const m = (window as any).offgridMap;
            if (m.loaded() && m.areTilesLoaded()) r();
            else m.once("idle", () => r());
          }),
      );
      if (zoom === 13 || zoom === 8) await page.screenshot({ path: `test-results/glyphs-${name}-z${zoom}.png` });
    }
  }
  const log = (await (await request.get("/__log")).json()) as { path: string }[];
  const byStack: Record<string, string[]> = {};
  for (const { path } of log) {
    const m = /\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/.exec(path);
    if (!m) continue;
    const stack = decodeURIComponent(m[1]);
    (byStack[stack] ??= []).push(m[2]);
  }
  for (const k of Object.keys(byStack)) byStack[k] = [...new Set(byStack[k])].sort((a, b) => parseInt(a) - parseInt(b));
  writeFileSync("test-results/glyph-ranges.json", JSON.stringify(byStack, null, 2));
  console.log(JSON.stringify(byStack));
});
