import { describe, expect, it } from "vitest";
import { fontstacks, offlineStyle } from "./style";

const style = {
  version: 8,
  sources: { openmaptiles: { type: "vector", url: "pmtiles://https://z.yuiseki.net/static/openstreetmap/planet/planet.pmtiles" } },
  glyphs: "https://z.yuiseki.net/static/maps/fonts/{fontstack}/{range}.pbf",
  sprite: "https://z.yuiseki.net/static/maps/sprites/sprite",
  layers: [
    { id: "bg", type: "background" },
    { id: "a", type: "symbol", layout: { "text-font": ["Noto Sans Regular"] } },
    { id: "b", type: "symbol", layout: { "text-font": ["Noto Sans Bold"] } },
    { id: "c", type: "symbol", layout: { "text-font": ["Noto Sans Regular"] } },
    { id: "d", type: "symbol", layout: { "text-font": ["literal", ["Noto Sans Italic"]] } },
  ],
};

describe("offlineStyle", () => {
  const out = offlineStyle(style, "http://localhost:8080/static/openstreetmap/kanto.pmtiles", "http://localhost:8080/static/maps/");

  it("points the vector source at the downloaded archive", () => {
    expect(out.sources.openmaptiles).toEqual({
      type: "vector",
      url: "pmtiles://http://localhost:8080/static/openstreetmap/kanto.pmtiles",
    });
  });

  it("serves glyphs and sprites from next to the app so they hit the same cache keys offline", () => {
    expect(out.glyphs).toBe("http://localhost:8080/static/maps/fonts/{fontstack}/{range}.pbf");
    expect(out.sprite).toBe("http://localhost:8080/static/maps/sprites/sprite");
  });

  it("does not modify the input", () => {
    expect(style.sources.openmaptiles.url).toContain("planet.pmtiles");
  });
});

describe("fontstacks", () => {
  it("lists each font stack once, including ones wrapped in a literal expression", () => {
    expect(fontstacks(style).sort()).toEqual(["Noto Sans Bold", "Noto Sans Italic", "Noto Sans Regular"]);
  });
});
