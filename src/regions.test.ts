import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findPath, opfsName, sharedOpfsNames, type RegionNode } from "./regions";

const catalog: RegionNode = {
  id: "world",
  name: "世界",
  children: [
    {
      id: "japan",
      name: "日本",
      children: [
        {
          id: "kanto",
          name: "関東",
          pmtiles: {
            url: "../../openstreetmap/regions/asia/japan/kanto/kanto-251124.pmtiles",
            bytes: 295_000_000,
            maxzoom: 14,
          },
        },
      ],
    },
  ],
};

describe("findPath", () => {
  it("returns the chain from the root to the node", () => {
    expect(findPath(catalog, "kanto")?.map((n) => n.id)).toEqual(["world", "japan", "kanto"]);
  });

  it("returns just the root for the root", () => {
    expect(findPath(catalog, "world")?.map((n) => n.id)).toEqual(["world"]);
  });

  it("returns null for an unknown id", () => {
    expect(findPath(catalog, "kansai")).toBeNull();
  });
});

describe("opfsName", () => {
  it("uses the last path segment so the service worker can find the file from the URL alone", () => {
    expect(opfsName("https://z.yuiseki.net/static/openstreetmap/regions/asia/japan/kanto/kanto-251124.pmtiles")).toBe(
      "kanto-251124.pmtiles",
    );
  });

  it("ignores the query string", () => {
    expect(opfsName("https://example.com/a/b/kanto.pmtiles?v=2")).toBe("kanto.pmtiles");
  });
});

describe("sharedOpfsNames", () => {
  const leaf = (id: string, url: string): RegionNode => ({ id, name: id, pmtiles: { url, bytes: 1, maxzoom: 14 } });

  it("finds archives in different directories that would be stored under one name", () => {
    const root: RegionNode = {
      id: "world",
      name: "世界",
      children: [
        leaf("georgia-us", "../../openstreetmap/regions/north-america/us/georgia-251124.pmtiles"),
        leaf("georgia", "../../openstreetmap/regions/asia/georgia-251124.pmtiles"),
        leaf("tokyo", "prefectures/tokyo-251124.pmtiles"),
      ],
    };
    expect(sharedOpfsNames(root)).toEqual([["georgia-251124.pmtiles", ["georgia-us", "georgia"]]]);
  });

  it("finds none in the published catalogue", () => {
    const published = JSON.parse(readFileSync("public/regions.json", "utf8")) as RegionNode;
    expect(sharedOpfsNames(published)).toEqual([]);
  });
});
