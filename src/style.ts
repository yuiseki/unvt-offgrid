import { GLYPHS_PATH, SPRITE_PATH } from "./assets";

// Loose on purpose: only the fields touched here are typed.
export interface StyleLike {
  sources: Record<string, { type: string; url?: string; [k: string]: unknown }>;
  glyphs?: string;
  sprite?: unknown;
  layers: { layout?: Record<string, unknown>; [k: string]: unknown }[];
  [k: string]: unknown;
}

/**
 * The published style, pointed at a downloaded region archive, with glyphs
 * and sprites taken from `mapsBase` (the same origin as the app).
 */
export function offlineStyle<S extends StyleLike>(style: S, archiveUrl: string, mapsBase: string): S {
  const out = structuredClone(style);
  for (const src of Object.values(out.sources)) {
    if (src.type === "vector" && typeof src.url === "string" && src.url.startsWith("pmtiles://")) {
      src.url = `pmtiles://${archiveUrl}`;
    }
  }
  out.glyphs = mapsBase + GLYPHS_PATH;
  out.sprite = mapsBase + SPRITE_PATH;
  return out;
}

/** Every font stack named by a layer's `text-font`. */
export function fontstacks(style: StyleLike): string[] {
  const found = new Set<string>();
  for (const layer of style.layers) {
    let v = layer.layout?.["text-font"];
    if (Array.isArray(v) && v[0] === "literal") v = v[1];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) found.add(v.join(","));
  }
  return [...found];
}
