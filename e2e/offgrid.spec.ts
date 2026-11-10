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

/**
 * From the world level down to a leaf under Kanto, and download it. With a
 * region already downloaded the app opens its map, so go back to the picker.
 */
async function download(page: Page, leaf: RegExp, leafId: string) {
  await page.goto("./");
  await expect(page.locator("body")).toHaveAttribute("data-view", /select|map/);
  if ((await page.locator("body").getAttribute("data-view")) === "map") {
    await page.locator("#menu").click();
    await page.locator(".crumbs button", { hasText: "世界" }).click();
  }
  await expect(page.locator("body")).toHaveAttribute("data-node", "world");
  await page.getByRole("button", { name: /^日本/ }).click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "japan");
  await page.getByRole("button", { name: /^関東/ }).click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanto");
  // The arrow next to the name downloads without leaving the list.
  await expect(page.locator(".row", { has: page.getByRole("button", { name: leaf }) })).toHaveAttribute("data-region", leafId);
  await page.locator(`.row[data-region="${leafId}"] button.dl`).click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map", { timeout: 30_000 });
  await expect(page.locator("body")).toHaveAttribute("data-node", leafId);
}

const downloadKanto = (page: Page) => download(page, /^関東まるごと/, "kanto-all");

/** Ids of the pickable outlines currently on the selection map. */
async function pickIds(page: Page) {
  return page.evaluate(() =>
    [...new Set((window as any).offgridMap.querySourceFeatures("pick").map((f: any) => f.properties.id))].sort(),
  );
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

test("after a download the map opens offline, with tiles from OPFS", async ({ page, context }) => {
  await downloadKanto(page);
  await idle(page);
  await page.evaluate(() => navigator.serviceWorker.ready);

  const fromNetwork: string[] = [];
  const fromOpfs: string[] = [];
  page.on("response", (r) => {
    if (!r.url().endsWith(".pmtiles")) return;
    (r.headers()["x-offgrid"] === "opfs" ? fromOpfs : fromNetwork).push(r.url());
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map");
  await idle(page);
  const layers = await page.evaluate(() =>
    [...new Set((window as any).offgridMap.queryRenderedFeatures().map((f: any) => f.sourceLayer))].sort(),
  );
  expect(layers).toContain("water");
  expect(layers).toContain("transportation");
  expect(fromOpfs.length).toBeGreaterThan(0);
  expect(fromNetwork).toEqual([]);
});

test("outside the region the missing tiles are drawn as open sea", async ({ page }) => {
  await downloadKanto(page);
  await idle(page);
  // Inland Australia: certainly land, certainly not in the Kanto archive.
  await page.evaluate(() => (window as any).offgridMap.jumpTo({ center: [134, -25], zoom: 6 }));
  await idle(page);
  const water = await page.evaluate(() => {
    const m = (window as any).offgridMap;
    const c = m.project(m.getCenter());
    return m
      .queryRenderedFeatures([c.x, c.y])
      .filter((f: any) => f.sourceLayer === "water")
      .map((f: any) => f.properties.class);
  });
  expect(water).toContain("ocean");
});

test("an interrupted download resumes where it stopped", async ({ page, request }) => {
  await request.post("/__cut?after=400000");
  await page.goto("./");
  await page.getByRole("button", { name: /^日本/ }).click();
  await page.getByRole("button", { name: /^関東/ }).click();
  await page.getByRole("button", { name: /^関東まるごと/ }).click();
  await page.locator("#download").click();
  await expect(page.locator("#status")).toContainText("失敗", { timeout: 20_000 });
  const part = await opfsFile(page, ARCHIVE + ".part");
  expect(part?.size).toBe(400000);
  expect(await opfsFile(page, ARCHIVE)).toBeNull();

  await request.get("/__log");
  await page.getByRole("button", { name: "戻る" }).click();
  await page.locator("#download").click(); // now "続きをダウンロード"
  await expect(page.locator("body")).toHaveAttribute("data-view", "map", { timeout: 30_000 });
  const log = (await (await request.get("/__log")).json()) as { path: string; range: string | null }[];
  const archiveRequests = log.filter((r) => r.path.endsWith(ARCHIVE));
  expect(archiveRequests[0]?.range).toBe("bytes=400000-");
  expect(await opfsFile(page, ARCHIVE)).toEqual({ size: FIXTURE_SIZE, sha256: FIXTURE_SHA256 });
});

test("a downloaded region can be deleted", async ({ page }) => {
  await downloadKanto(page);
  page.once("dialog", (d) => d.accept());
  await page.locator("#menu").click();
  await page.getByRole("button", { name: /^関東まるごと/ }).click(); // its details
  await page.locator("#delete").click();
  await expect(page.locator("#download")).toBeVisible();
  expect(await opfsFile(page, ARCHIVE)).toBeNull();
});

test("the download does not start when the quota is too small", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.storage.estimate = async () => ({ quota: 1000, usage: 0 });
  });
  await page.goto("./");
  await page.getByRole("button", { name: /^日本/ }).click();
  await page.getByRole("button", { name: /^関東/ }).click();
  await page.getByRole("button", { name: /^関東まるごと/ }).click();
  await page.locator("#download").click();
  await expect(page.locator("#status")).toContainText("空き容量が足りません");
  expect(await opfsFile(page, ARCHIVE + ".part")).toBeNull();
});

test("Safari gets a warning about the seven-day eviction", async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  await page.goto("./");
  await expect(page.locator("#warnings")).toContainText("7日間");
  await ctx.close();
});

test("Kanto offers the whole region and its seven prefectures", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /^日本/ }).click();
  await page.getByRole("button", { name: /^関東/ }).click();
  await expect(page.locator(".children .name")).toHaveText([
    /^関東まるごと/,
    /^茨城県/,
    /^栃木県/,
    /^群馬県/,
    /^埼玉県/,
    /^千葉県/,
    /^東京都/,
    /^神奈川県/,
  ]);
  await idle(page);
  // The prefectures are pickable on the map; the whole of Kanto only from the list.
  expect(await pickIds(page)).toEqual(["chiba", "gunma", "ibaraki", "kanagawa", "saitama", "tochigi", "tokyo"]);
});

test("two regions can be kept, and the last one opened comes up on start", async ({ page }) => {
  await download(page, /^東京都/, "tokyo");
  expect((await opfsFile(page, "tokyo-251124.pmtiles"))?.size).toBe(FIXTURE_SIZE);
  await download(page, /^関東まるごと/, "kanto-all");
  expect((await opfsFile(page, "tokyo-251124.pmtiles"))?.size).toBe(FIXTURE_SIZE);
  expect((await opfsFile(page, ARCHIVE))?.size).toBe(FIXTURE_SIZE);

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map");
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanto-all");

  // ☰ on the map goes back to the Kanto list; open Tokyo from its row, and
  // it is what comes up next time.
  await page.locator("#menu").click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanto");
  await page.locator('.row[data-region="tokyo"] button.open').click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "tokyo");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map");
  await expect(page.locator("body")).toHaveAttribute("data-node", "tokyo");
});

test("the picker works offline, prefecture outlines included", async ({ page, context }) => {
  await downloadKanto(page);
  await idle(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map");
  await page.locator("#menu").click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanto");
  await idle(page);
  expect(await pickIds(page)).toHaveLength(7);
});

test("tapping a name zooms into that region; the arrow is only on downloadable ones", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".row button.dl")).toHaveCount(0); // 日本 has no archive of its own
  await page.getByRole("button", { name: /^日本/ }).click();
  await page.getByRole("button", { name: /^関東/ }).click();
  await expect(page.locator(".row button.dl")).toHaveCount(8);
  await page.getByRole("button", { name: /^神奈川県/ }).click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanagawa");
  await expect(page.locator("body")).toHaveAttribute("data-view", "select");
  // Kanagawa is framed in the part of the map below the list.
  const view = await page.evaluate(() => {
    const m = (window as any).offgridMap;
    const top = document.getElementById("panel")!.getBoundingClientRect().bottom;
    const nw = m.unproject([0, top]);
    const se = m.unproject([m.getCanvas().clientWidth, m.getCanvas().clientHeight]);
    return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
  });
  expect(view.west).toBeLessThan(138.9);
  expect(view.east).toBeGreaterThan(139.787);
  expect(view.north).toBeGreaterThan(35.654);
  expect(view.south).toBeLessThan(35.117);
  await expect(page.locator("#download")).toBeVisible();
});

test("after a download the row offers the map instead of the arrow", async ({ page }) => {
  await download(page, /^千葉県/, "chiba");
  await page.locator("#menu").click();
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanto");
  const row = page.locator('.row[data-region="chiba"]');
  await expect(row.locator("button.dl")).toHaveCount(0);
  await row.locator("button.open").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map");
  await expect(page.locator("body")).toHaveAttribute("data-node", "chiba");
});

test("the menu folds away and comes back; on the map it starts folded", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /^日本/ }).click();
  const menu = page.locator("#menu");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toContainText("日本");
  await expect(page.locator("#panel")).toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#panel")).toBeHidden();
  // Folded, the region can still be picked on the map.
  await idle(page);
  await page.evaluate(() => {
    const m = (window as any).offgridMap;
    m.jumpTo({ center: [139.0, 36.5], zoom: 6 }); // Gunma, inside Kanto
  });
  await idle(page);
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanto");
  await menu.click();
  await expect(page.locator("#panel")).toBeVisible();

  await page.locator('.row[data-region="gunma"] button.dl').click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "map", { timeout: 30_000 });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toContainText("群馬県");
  await menu.click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "select");
  await expect(page.locator("body")).toHaveAttribute("data-node", "kanto");
  await expect(page.locator("#panel")).toBeVisible();
});
