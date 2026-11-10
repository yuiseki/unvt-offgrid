import { describe, expect, it } from "vitest";
import { OCEAN_TILE, parsePmtilesUrl, worldTileJson } from "./tiles";

describe("OCEAN_TILE", () => {
  it("is the planet's whole-tile ocean polygon (uncompressed MVT with one water layer)", () => {
    expect(OCEAN_TILE.length).toBe(58);
    const text = new TextDecoder().decode(OCEAN_TILE);
    expect(text).toContain("water");
    expect(text).toContain("ocean");
  });
});

describe("parsePmtilesUrl", () => {
  it("parses a tile URL", () => {
    expect(parsePmtilesUrl("pmtiles://https://example.com/a/kanto.pmtiles/14/14550/6450")).toEqual({
      archive: "https://example.com/a/kanto.pmtiles",
      tile: { z: 14, x: 14550, y: 6450 },
    });
  });

  it("accepts the extension pmtiles.js puts on tile URLs", () => {
    expect(parsePmtilesUrl("pmtiles://https://example.com/a/kanto.pmtiles/3/7/2.mvt")?.tile).toEqual({ z: 3, x: 7, y: 2 });
  });

  it("parses a TileJSON URL", () => {
    expect(parsePmtilesUrl("pmtiles://https://example.com/a/kanto.pmtiles")).toEqual({
      archive: "https://example.com/a/kanto.pmtiles",
      tile: null,
    });
  });

  it("returns null for other schemes", () => {
    expect(parsePmtilesUrl("https://example.com/a/kanto.pmtiles")).toBeNull();
  });
});

describe("worldTileJson", () => {
  it("widens the bounds to the whole world so MapLibre asks for tiles outside the region", () => {
    const tj = worldTileJson(
      { tilejson: "3.0.0", tiles: ["pmtiles://x/{z}/{x}/{y}"], bounds: [138, 24, 154, 37], minzoom: 0, maxzoom: 14 },
      "pmtiles://x",
    );
    expect(tj.bounds).toEqual([-180, -85.051129, 180, 85.051129]);
    expect(tj.tiles).toEqual(["pmtiles://x/{z}/{x}/{y}"]);
    expect(tj.maxzoom).toBe(14);
  });
});
