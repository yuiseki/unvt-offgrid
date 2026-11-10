/**
 * The planet archive's open-ocean tile: one `water` polygon with class=ocean
 * covering the whole tile (plus buffer), uncompressed MVT.
 *
 * In the OpenMapTiles schema there is no land layer: land is whatever the
 * background colour shows through. A region cut to its admin polygon has no
 * tiles over the surrounding sea, so the sea would be painted in the land
 * colour. Answering every tile the archive lacks with this tile paints it as
 * sea instead. The price is that land outside the region looks like sea too.
 *
 * In planet.pmtiles every open-ocean tile at every zoom has these bytes
 * except the feature id, which MapLibre does not use for drawing.
 */
export const OCEAN_TILE = new Uint8Array([
  26, 56, 10, 5, 119, 97, 116, 101, 114, 18, 26, 8, 244, 172, 8, 18, 2, 0, 0, 24, 3, 34, 14, 9, 127, 127, 26, 128, 66,
  0, 0, 128, 66, 255, 65, 0, 15, 26, 5, 99, 108, 97, 115, 115, 34, 7, 10, 5, 111, 99, 101, 97, 110, 40, 128, 32, 120,
  2,
]);

export interface ParsedPmtilesUrl {
  archive: string;
  tile: { z: number; x: number; y: number } | null;
}

/** Split `pmtiles://<archive>[/z/x/y]`. */
export function parsePmtilesUrl(url: string): ParsedPmtilesUrl | null {
  if (!url.startsWith("pmtiles://")) return null;
  const rest = url.slice("pmtiles://".length);
  const m = /^(.*)\/(\d+)\/(\d+)\/(\d+)(\.\w+)?$/.exec(rest);
  if (m) return { archive: m[1], tile: { z: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } };
  return { archive: rest, tile: null };
}

export interface TileJson {
  tilejson: string;
  tiles: string[];
  bounds?: number[];
  minzoom?: number;
  maxzoom?: number;
  [k: string]: unknown;
}

/**
 * MapLibre never requests tiles outside a source's `bounds`, so with the
 * region's own bounds the sea around it would stay blank. Widen them.
 */
export function worldTileJson(tj: TileJson, sourceUrl: string): TileJson {
  return {
    ...tj,
    tiles: [`${sourceUrl}/{z}/{x}/{y}`],
    bounds: [-180, -85.051129, 180, 85.051129],
  };
}
