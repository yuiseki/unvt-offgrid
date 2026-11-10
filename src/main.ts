import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { PMTiles } from "pmtiles";
import { ASSET_CACHE, STYLE_PATH, glyphUrls, mapsBase } from "./assets";
import type { DownloadEvent, DownloadRequest } from "./download-worker";
import { isSafari } from "./env";
import { OPFS_DIR, PART_SUFFIX, findPath, leaves, opfsName, type RegionNode } from "./regions";
import { fontstacks, offlineStyle, type StyleLike } from "./style";
import { OCEAN_TILE, parsePmtilesUrl, worldTileJson, type TileJson } from "./tiles";

/** Hashed file names of the workers, from the build. */
declare const __FILES__: { maplibreWorker: string; downloadWorker: string };

// maplibre-gl v6 cannot find its worker from inside a bundle.
maplibregl.setWorkerUrl(new URL(`./${__FILES__.maplibreWorker}`, location.href).href);

const APP_URL = new URL("./", location.href).href;
const CATALOG_URL = new URL("./regions.json", APP_URL).href;
const MAPS_BASE = mapsBase(APP_URL);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const panel = $<HTMLDivElement>("panel");

// ---------------------------------------------------------------- tiles

const archives = new Map<string, PMTiles>();
maplibregl.addProtocol("pmtiles", async (params, abort) => {
  const parsed = parsePmtilesUrl(params.url);
  if (!parsed) throw new Error(`not a pmtiles URL: ${params.url}`);
  let archive = archives.get(parsed.archive);
  if (!archive) {
    archive = new PMTiles(parsed.archive);
    archives.set(parsed.archive, archive);
  }
  if (!parsed.tile) {
    const tj = (await archive.getTileJson(params.url)) as TileJson;
    return { data: worldTileJson(tj, params.url) };
  }
  const { z, x, y } = parsed.tile;
  const tile = await archive.getZxy(z, x, y, abort.signal);
  // Outside the region: the archive has no tile, draw open sea (see tiles.ts).
  return { data: tile ? new Uint8Array(tile.data) : OCEAN_TILE.slice() };
});

// ---------------------------------------------------------------- storage

async function regionsDir(create = false): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_DIR, { create });
  } catch {
    return null;
  }
}

async function storedSize(name: string): Promise<number | null> {
  const dir = await regionsDir();
  if (!dir) return null;
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size;
  } catch {
    return null;
  }
}

function archiveUrl(node: RegionNode): string {
  return new URL(node.pmtiles!.url, CATALOG_URL).href;
}

async function isDownloaded(node: RegionNode): Promise<boolean> {
  return (await storedSize(opfsName(archiveUrl(node)))) === node.pmtiles!.bytes;
}

async function deleteRegion(node: RegionNode): Promise<void> {
  const dir = await regionsDir();
  const name = opfsName(archiveUrl(node));
  for (const n of [name, name + PART_SUFFIX]) {
    try {
      await dir?.removeEntry(n);
    } catch {
      // not there
    }
  }
  archives.delete(archiveUrl(node));
}

const mb = (n: number) => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;

// ---------------------------------------------------------------- map

const SELECT_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "sea", type: "background", paint: { "background-color": "#a9d3e8" } }],
};

// Created in start(), so that a failure (no WebGL2, say) is shown, not hidden.
let map: maplibregl.Map;

function createMap() {
  map = new maplibregl.Map({
    container: "map",
    style: SELECT_STYLE,
    center: [139.7, 35.7],
    zoom: 1,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  (window as unknown as { offgridMap: maplibregl.Map }).offgridMap = map;
}

let catalog: RegionNode;
let pickHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;

function setPickHandler(h: ((e: maplibregl.MapLayerMouseEvent) => void) | null) {
  if (pickHandler) map.off("click", "pick", pickHandler);
  pickHandler = h;
  if (h) map.on("click", "pick", h);
}

async function showSelection(id: string) {
  const path = findPath(catalog, id) ?? [catalog];
  const node = path[path.length - 1];
  document.body.dataset.view = "select";
  document.body.dataset.node = node.id;
  map.setStyle(SELECT_STYLE);
  await new Promise<void>((r) => (map.isStyleLoaded() ? r() : map.once("style.load", () => r())));

  const rel = (p: string) => new URL(p, CATALOG_URL).href;
  map.addSource("world", { type: "geojson", data: rel(catalog.outline!) });
  map.addLayer({ id: "world", type: "fill", source: "world", paint: { "fill-color": "#e8e4da", "fill-outline-color": "#b8b2a4" } });
  if (node.backdrop) {
    map.addSource("backdrop", { type: "geojson", data: rel(node.backdrop) });
    map.addLayer({ id: "backdrop", type: "line", source: "backdrop", paint: { "line-color": "#9a9384", "line-width": 0.6 } });
  }
  const children = node.children ?? [];
  map.addSource("pick", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "pick", type: "fill", source: "pick", paint: { "fill-color": "#e0662a", "fill-opacity": 0.45 } });
  map.addLayer({ id: "pick-line", type: "line", source: "pick", paint: { "line-color": "#b8441a", "line-width": 1.5 } });
  const features = await Promise.all(
    // A child drawn with the parent's own outline (the whole of Kanto among
    // its prefectures) would cover its siblings: list it, do not draw it.
    [...children.filter((c) => c.outline !== node.outline), ...(node.pmtiles ? [node] : [])]
      .filter((c) => c.outline)
      .map(async (c) => {
        const gj = (await (await fetch(rel(c.outline!))).json()) as FeatureCollection;
        return gj.features.map((f) => ({ ...f, properties: { id: c.id } }));
      }),
  );
  (map.getSource("pick") as GeoJSONSource).setData({ type: "FeatureCollection", features: features.flat() });
  setPickHandler((e) => {
    const picked = e.features?.[0]?.properties?.id as string | undefined;
    if (picked && picked !== node.id) void showSelection(picked);
  });
  if (node.bbox) map.fitBounds(node.bbox as [number, number, number, number], { padding: 24, duration: 0 });

  panel.replaceChildren(breadcrumb(path));
  if (node.pmtiles) {
    panel.append(await leafPanel(node));
  } else {
    const list = document.createElement("ul");
    list.className = "children";
    for (const c of children) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.textContent = c.name;
      b.dataset.region = c.id;
      const sizes = leaves(c).map((l) => l.pmtiles!.bytes);
      if (sizes.length) {
        const s = document.createElement("small");
        s.textContent = ` ${mb(sizes.reduce((a, n) => a + n, 0))}`;
        b.append(s);
      }
      b.onclick = () => void showSelection(c.id);
      li.append(b);
      list.append(li);
    }
    panel.append(list);
  }
}

function breadcrumb(path: RegionNode[]): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "crumbs";
  path.forEach((n, i) => {
    if (i > 0) nav.append(" › ");
    if (i === path.length - 1) {
      const s = document.createElement("strong");
      s.textContent = n.name;
      nav.append(s);
    } else {
      const a = document.createElement("button");
      a.textContent = n.name;
      a.onclick = () => void showSelection(n.id);
      nav.append(a);
    }
  });
  return nav;
}

async function leafPanel(node: RegionNode): Promise<HTMLElement> {
  const info = node.pmtiles!;
  const box = document.createElement("div");
  box.className = "leaf";
  const meta = document.createElement("p");
  meta.textContent = `${mb(info.bytes)} ・ ズーム 0〜${info.maxzoom}${info.osmDate ? ` ・ OSM ${info.osmDate}` : ""}`;
  box.append(meta);
  const status = document.createElement("p");
  status.id = "status";
  box.append(status);
  const actions = document.createElement("div");
  actions.className = "actions";
  box.append(actions);

  const button = (label: string, id: string, onclick: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.id = id;
    b.onclick = onclick;
    actions.append(b);
    return b;
  };

  if (await isDownloaded(node)) {
    status.textContent = "ダウンロード済み。オフラインで見られます。";
    button("地図を開く", "open", () => void showMap(node));
    button("削除", "delete", async () => {
      if (!confirm(`${node.name} の地図 (${mb(info.bytes)}) を端末から削除しますか`)) return;
      await deleteRegion(node);
      void showSelection(node.id);
    });
  } else {
    const part = (await storedSize(opfsName(archiveUrl(node)) + PART_SUFFIX)) ?? 0;
    if (part > 0) status.textContent = `途中まで (${mb(part)}) 保存されています。続きから再開します。`;
    button(part > 0 ? "続きをダウンロード" : "ダウンロード", "download", () => void download(node, box, status));
  }
  return box;
}

async function download(node: RegionNode, box: HTMLElement, status: HTMLElement) {
  const info = node.pmtiles!;
  const url = archiveUrl(node);
  const part = (await storedSize(opfsName(url) + PART_SUFFIX)) ?? 0;
  const need = info.bytes - part;
  const est = await navigator.storage.estimate();
  const free = (est.quota ?? 0) - (est.usage ?? 0);
  if (free < need * 1.02) {
    status.textContent = `空き容量が足りません。あと ${mb(need)} 必要ですが、このブラウザで使えるのは ${mb(free)} です。`;
    status.className = "error";
    return;
  }
  const persisted = await navigator.storage.persist();
  box.querySelector(".actions")?.replaceChildren();
  const bar = document.createElement("progress");
  bar.max = info.bytes;
  bar.value = part;
  box.append(bar);
  const cancel = document.createElement("button");
  cancel.textContent = "中断";
  box.querySelector(".actions")?.append(cancel);

  await regionsDir(true);
  const worker = new Worker(new URL(`./${__FILES__.downloadWorker}`, APP_URL));
  cancel.onclick = () => {
    worker.terminate();
    void showSelection(node.id);
  };
  const result = await new Promise<DownloadEvent>((resolve) => {
    worker.onmessage = (e: MessageEvent<DownloadEvent>) => {
      if (e.data.type === "progress") {
        bar.value = e.data.received;
        status.textContent = `${mb(e.data.received)} / ${mb(e.data.total)}`;
      } else resolve(e.data);
    };
    worker.onerror = (e) => resolve({ type: "error", message: e.message });
    worker.postMessage({ type: "start", url, bytes: info.bytes } satisfies DownloadRequest);
  });
  worker.terminate();
  if (result.type === "error") {
    status.textContent = `ダウンロードに失敗しました: ${result.message}`;
    status.className = "error";
    bar.remove();
    cancel.textContent = "戻る";
    cancel.onclick = () => void showSelection(node.id);
    return;
  }
  status.textContent = "文字の形のデータを保存しています…";
  await prefetchGlyphs();
  if (!persisted) console.warn("navigator.storage.persist() was not granted; the browser may evict the download.");
  await showMap(node);
}

async function fetchStyle(): Promise<StyleLike> {
  const res = await fetch(MAPS_BASE + STYLE_PATH);
  if (!res.ok) throw new Error(`style: HTTP ${res.status}`);
  return (await res.json()) as StyleLike;
}

async function prefetchGlyphs() {
  const cache = await caches.open(ASSET_CACHE);
  const urls = glyphUrls(APP_URL, fontstacks(await fetchStyle()));
  const results = await Promise.allSettled(urls.map((u) => cache.add(u)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) console.warn(`${failed} of ${urls.length} glyph ranges could not be cached`);
}

const LAST_KEY = "offgrid:last-region";

function rememberLast(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // storage blocked: start falls back to the first downloaded region
  }
}

function lastOpened(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

async function showMap(node: RegionNode) {
  setPickHandler(null);
  rememberLast(node.id);
  const style = offlineStyle(await fetchStyle(), archiveUrl(node), MAPS_BASE);
  const loaded = new Promise<void>((r) => map.once("style.load", () => r()));
  map.setStyle(style as unknown as StyleSpecification);
  if (node.bbox) map.fitBounds(node.bbox as [number, number, number, number], { padding: 8, duration: 0 });
  // Mark the view only once the region's style is in: until then the map
  // still holds the picker's style, which is already "loaded".
  await loaded;
  document.body.dataset.view = "map";
  document.body.dataset.node = node.id;
  const back = document.createElement("button");
  back.id = "regions";
  back.textContent = "地域を選ぶ";
  back.onclick = () => void showSelection(node.id);
  panel.replaceChildren(back);
}

// ---------------------------------------------------------------- start

function warnings() {
  const box = $<HTMLDivElement>("warnings");
  if (isSafari(navigator.userAgent)) {
    const p = document.createElement("p");
    p.textContent =
      "Safari では、7日間このページを開かないと保存した地図が消されることがあります。Android の Chrome などでの利用をおすすめします。";
    box.append(p);
  }
  if (!("storage" in navigator) || typeof navigator.storage.getDirectory !== "function") {
    const p = document.createElement("p");
    p.textContent = "このブラウザは端末内への地図の保存 (OPFS) に対応していません。";
    box.append(p);
  }
}

async function start() {
  warnings();
  createMap();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch((e) => console.error("service worker", e));
  }
  catalog = (await (await fetch(CATALOG_URL)).json()) as RegionNode;
  // Open the map straight away if a region is already on the device:
  // the one opened last, else the first in the catalogue.
  const all = leaves(catalog);
  const last = all.find((l) => l.id === lastOpened());
  for (const leaf of last ? [last, ...all] : all) {
    if (await isDownloaded(leaf)) return showMap(leaf);
  }
  return showSelection(catalog.id);
}

start().catch((e) => {
  console.error(e);
  panel.textContent = `起動に失敗しました: ${e instanceof Error ? e.message : String(e)}`;
});
