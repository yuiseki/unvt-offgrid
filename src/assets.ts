/**
 * What the app needs besides the region archive, and where it lives.
 *
 * The app is served from <maps>/offgrid/ and shares the style, sprites and
 * glyphs already published under <maps>/ (styles/, sprites/, fonts/).
 */

/** Precached on install, relative to the service worker scope. */
export const SHELL_FILES = [
  "./",
  "./index.html",
  "./main.js",
  "./main.css",
  "./download-worker.js",
  "./maplibre-gl-worker.mjs",
  "./regions.json",
  "./geo/world.geojson",
  "./geo/japan.geojson",
  "./geo/japan-prefectures.geojson",
  "./geo/kanto.geojson",
];

/** Kept across app updates: map assets do not change with the app version. */
export const ASSET_CACHE = "offgrid-assets";

export const STYLE_PATH = "styles/osm-bright.json";
export const SPRITE_PATH = "sprites/sprite";
export const GLYPHS_PATH = "fonts/{fontstack}/{range}.pbf";

/** <maps>/ for an app at <maps>/offgrid/. */
export function mapsBase(appUrl: string): string {
  return new URL("../", appUrl).href;
}

/** Style and sprites, precached by the service worker. */
export function assetUrls(appUrl: string): string[] {
  const base = mapsBase(appUrl);
  return [
    base + STYLE_PATH,
    ...["", "@2x"].flatMap((r) => [`${base}${SPRITE_PATH}${r}.json`, `${base}${SPRITE_PATH}${r}.png`]),
  ];
}

/**
 * Glyph ranges fetched for offline use after a region download.
 *
 * MapLibre draws CJK ideographs, hiragana and katakana with a local font
 * (`localIdeographFontFamily`) and never asks for those ranges. The ranges
 * below are the ones it did ask for while browsing Kanto online
 * (recorded by e2e/record-glyphs.spec.ts); fetching every range of the three
 * font stacks would be about 100 MB.
 */
export const GLYPH_RANGES = ["0-255"];

export function glyphUrls(appUrl: string, fontstacks: string[]): string[] {
  const base = mapsBase(appUrl);
  return fontstacks.flatMap((fs) =>
    // Same encoding as MapLibre's request: the raw name, normalised by URL.
    GLYPH_RANGES.map((r) => new URL(base + GLYPHS_PATH.replace("{fontstack}", fs).replace("{range}", r)).href),
  );
}
