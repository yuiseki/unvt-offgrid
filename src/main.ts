import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification, VectorTileSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { PMTiles } from "pmtiles";
import { ASSET_CACHE, STYLE_PATH, glyphUrls, mapsBase } from "./assets";
import type { DownloadEvent, DownloadRequest } from "./download-worker";
import { isSafari } from "./env";
import { OPFS_DIR, PART_SUFFIX, findPath, leaves, opfsName, type RegionNode } from "./regions";
import { fontstacks, offlineStyle, type StyleLike } from "./style";
import { OCEAN_TILE, overlaps, parsePmtilesUrl, tileBounds, worldTileJson, type TileJson } from "./tiles";

/** Hashed file names of the workers, from the build. */
declare const __FILES__: { maplibreWorker: string; downloadWorker: string };

// maplibre-gl v6 cannot find its worker from inside a bundle.
maplibregl.setWorkerUrl(new URL(`./${__FILES__.maplibreWorker}`, location.href).href);

const APP_URL = new URL("./", location.href).href;
const CATALOG_URL = new URL("./regions.json", APP_URL).href;
const MAPS_BASE = mapsBase(APP_URL);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const panel = $<HTMLDivElement>("panel");
const menu = $<HTMLButtonElement>("menu");

/** Fold or unfold the panel. The ☰ button shows where the user is. */
function setMenu(open: boolean, label?: string) {
  document.body.dataset.menu = open ? "open" : "closed";
  menu.setAttribute("aria-expanded", String(open));
  if (label !== undefined) menu.querySelector(".label")!.textContent = label;
}

/** Whether the user folded the list while picking a region. */
let pickerFolded = false;

/** What ☰ does: on the map it opens the picker, in the picker it folds the list. */
let onMenu: () => void = () => undefined;
menu.onclick = () => onMenu();

// ---------------------------------------------------------------- tiles

const archives = new Map<string, PMTiles>();
function archiveFor(url: string): PMTiles {
  let a = archives.get(url);
  if (!a) {
    a = new PMTiles(url);
    archives.set(url, a);
  }
  return a;
}

/**
 * The map draws one source, `pmtiles://offgrid-local-N`, that stands for every
 * archive on the device. Each tile is taken from the first archive that has
 * it; archives cut from the same planet hold identical copies of the tiles
 * along their shared borders, so the regions join without a seam. N changes
 * whenever the set of archives does, so MapLibre does not reuse old tiles.
 */
const LOCAL = "offgrid-local-";
let localArchives: string[] = [];
let localGen = 0;

/** Re-read which archives are on the device; true if the set changed. */
async function refreshLocal(): Promise<boolean> {
  const urls: string[] = [];
  for (const leaf of leaves(catalog)) if (await isDownloaded(leaf)) urls.push(archiveUrl(leaf));
  if (urls.join("\n") === localArchives.join("\n")) return false;
  for (const u of archives.keys()) if (!urls.includes(u)) archives.delete(u);
  localArchives = urls;
  localGen++;
  return true;
}

async function localTileJson(sourceUrl: string): Promise<TileJson> {
  if (localArchives.length === 0) throw new Error("no region on this device");
  const first = (await archiveFor(localArchives[0]).getTileJson(sourceUrl)) as TileJson;
  const headers = await Promise.all(localArchives.map((u) => archiveFor(u).getHeader()));
  return { ...worldTileJson(first, sourceUrl), minzoom: 0, maxzoom: Math.max(...headers.map((h) => h.maxZoom)) };
}

async function localTile(z: number, x: number, y: number, signal: AbortSignal): Promise<Uint8Array> {
  const bounds = tileBounds(z, x, y);
  for (const url of localArchives) {
    const archive = archiveFor(url);
    const h = await archive.getHeader();
    // An archive whose bounds miss the tile cannot have it: skip the lookup.
    if (!overlaps(bounds, [h.minLon, h.minLat, h.maxLon, h.maxLat])) continue;
    const tile = await archive.getZxy(z, x, y, signal);
    if (tile) return new Uint8Array(tile.data);
  }
  // No region has it: draw open sea (see tiles.ts).
  return OCEAN_TILE.slice();
}

maplibregl.addProtocol("pmtiles", async (params, abort) => {
  const parsed = parsePmtilesUrl(params.url);
  if (!parsed) throw new Error(`not a pmtiles URL: ${params.url}`);
  if (parsed.archive.startsWith(LOCAL)) {
    if (!parsed.tile) return { data: await localTileJson(params.url) };
    const { z, x, y } = parsed.tile;
    return { data: await localTile(z, x, y, abort.signal) };
  }
  // A single archive by URL.
  const archive = archiveFor(parsed.archive);
  if (!parsed.tile) return { data: worldTileJson((await archive.getTileJson(params.url)) as TileJson, params.url) };
  const { z, x, y } = parsed.tile;
  const tile = await archive.getZxy(z, x, y, abort.signal);
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

/**
 * Bumped by every move to another view. A view that is still being built
 * when the user moves on (taps are faster than fetches) checks it after each
 * await and gives up, instead of drawing over the newer view.
 */
let navSeq = 0;

let pickHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;

function setPickHandler(h: ((e: maplibregl.MapLayerMouseEvent) => void) | null) {
  if (pickHandler) map.off("click", "pick", pickHandler);
  pickHandler = h;
  if (h) map.on("click", "pick", h);
}

async function showSelection(id: string) {
  const seq = ++navSeq;
  const path = findPath(catalog, id) ?? [catalog];
  const node = path[path.length - 1];
  // Arriving from the map (or at start) the list is wanted; moving within
  // the picker, keep it folded or unfolded as the user left it.
  if (document.body.dataset.view !== "select") pickerFolded = false;
  document.body.dataset.view = "select";
  document.body.dataset.node = node.id;
  setMenu(!pickerFolded, node.name);
  onMenu = () => {
    pickerFolded = !pickerFolded;
    setMenu(!pickerFolded);
  };
  map.setStyle(SELECT_STYLE);
  await new Promise<void>((r) => (map.isStyleLoaded() ? r() : map.once("style.load", () => r())));
  if (seq !== navSeq) return;

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
  if (seq !== navSeq) return;
  (map.getSource("pick") as GeoJSONSource).setData({ type: "FeatureCollection", features: features.flat() });
  setPickHandler((e) => {
    const picked = e.features?.[0]?.properties?.id as string | undefined;
    if (picked && picked !== node.id) void showSelection(picked);
  });
  if (!(await renderPanel(path, seq))) return;
  // Frame the region in the part of the map the panel does not cover.
  if (node.bbox) {
    const below = document.body.dataset.menu === "open" ? panel : menu;
    const top = Math.min(below.getBoundingClientRect().bottom + 16, window.innerHeight * 0.6);
    map.fitBounds(node.bbox as [number, number, number, number], {
      padding: { top, bottom: 24, left: 24, right: 24 },
      duration: 0,
    });
  }
}

/**
 * Fill the panel for the last node of `path`. Built off the page and put in
 * only if the user has not moved on meanwhile; returns whether it was.
 */
async function renderPanel(path: RegionNode[], seq: number): Promise<boolean> {
  const node = path[path.length - 1];
  const parts: HTMLElement[] = [breadcrumb(path)];
  if (node.pmtiles) {
    parts.push(await leafPanel(node));
  } else {
    const list = document.createElement("ul");
    list.className = "children";
    for (const c of node.children ?? []) list.append(await row(c));
    parts.push(list);
  }
  if (seq !== navSeq) return false;
  panel.replaceChildren(...parts);
  return true;
}

/** Redraw the picker's panel where the user is, without moving the map. */
function rerender() {
  if (document.body.dataset.view !== "select") return;
  const path = findPath(catalog, document.body.dataset.node ?? "");
  if (path) void renderPanel(path, navSeq);
}

/**
 * One line of the list: the name (tap: go into that region) and, for a region
 * with an archive, an arrow that downloads it right there, or a map button
 * once it is on the device.
 */
async function row(c: RegionNode): Promise<HTMLElement> {
  const li = document.createElement("li");
  li.className = "row";
  li.dataset.region = c.id;
  const name = document.createElement("button");
  name.className = "name";
  name.textContent = c.name;
  const sizes = leaves(c).map((l) => l.pmtiles!.bytes);
  if (sizes.length) {
    const small = document.createElement("small");
    small.textContent = ` ${mb(sizes.reduce((a, n) => a + n, 0))}`;
    name.append(small);
  }
  name.onclick = () => void showSelection(c.id);
  const actions = document.createElement("span");
  actions.className = "actions";
  const status = document.createElement("span");
  status.className = "status";
  li.append(name, actions, status);
  if (c.pmtiles) {
    if (active.has(c.id)) {
      showProgress(c, li, actions, status);
    } else if (await isDownloaded(c)) {
      const open = document.createElement("button");
      open.className = "open";
      open.textContent = "地図";
      open.setAttribute("aria-label", `地図を開く: ${c.name}`);
      open.onclick = () => void showMap(c);
      actions.append(open);
    } else {
      const part = (await storedSize(opfsName(archiveUrl(c)) + PART_SUFFIX)) ?? 0;
      const dl = document.createElement("button");
      dl.className = "dl";
      dl.textContent = "↓";
      dl.title = part > 0 ? `続きをダウンロード (${mb(part)} まで保存済み)` : "ダウンロード";
      dl.setAttribute("aria-label", `${dl.title}: ${c.name}`);
      dl.onclick = () => {
        dl.disabled = true;
        void download(c);
      };
      actions.append(dl);
      showFailure(c, status);
    }
  }
  return li;
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

  if (active.has(node.id)) {
    showProgress(node, box, actions, status);
  } else if (await isDownloaded(node)) {
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
    const b = button(part > 0 ? "続きをダウンロード" : "ダウンロード", "download", () => {
      b.disabled = true;
      void download(node);
    });
    showFailure(node, status);
  }
  return box;
}

/** A running download, drawn into whichever view shows its region. */
function showProgress(node: RegionNode, box: HTMLElement, actions: HTMLElement, status: HTMLElement) {
  const d = active.get(node.id)!;
  const bar = document.createElement("progress");
  bar.max = d.total;
  bar.value = d.received;
  bar.dataset.progress = node.id;
  status.dataset.progressText = node.id;
  status.textContent = d.text;
  box.append(bar);
  const cancel = document.createElement("button");
  cancel.className = "cancel";
  cancel.textContent = "中断";
  cancel.setAttribute("aria-label", `中断: ${node.name}`);
  cancel.onclick = () => d.cancel();
  actions.append(cancel);
}

function showFailure(node: RegionNode, status: HTMLElement) {
  const message = failed.get(node.id);
  if (!message) return;
  status.textContent = message;
  status.className = "error";
}

/** Downloads under way, by region id. They outlive the view that started them. */
interface ActiveDownload {
  received: number;
  total: number;
  text: string;
  cancel: () => void;
}
const active = new Map<string, ActiveDownload>();
/** The last failure per region, shown until the next attempt. */
const failed = new Map<string, string>();

function updateProgress(id: string) {
  const d = active.get(id);
  if (!d) return;
  for (const bar of document.querySelectorAll<HTMLProgressElement>(`progress[data-progress="${id}"]`)) bar.value = d.received;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-progress-text="${id}"]`)) el.textContent = d.text;
}

/**
 * Download `node` into OPFS. Progress is drawn by whichever view shows the
 * region (see showProgress). If the user is still where they started it, the
 * map opens at the end; if they have moved on, they stay where they are.
 */
async function download(node: RegionNode) {
  if (active.has(node.id)) return;
  const info = node.pmtiles!;
  const url = archiveUrl(node);
  const seq = navSeq;
  let stop: () => void = () => undefined;
  const d: ActiveDownload = { received: 0, total: info.bytes, text: "", cancel: () => stop() };
  active.set(node.id, d);
  failed.delete(node.id);
  let result: DownloadEvent | { type: "cancelled" };
  let persisted = false;
  try {
    d.received = (await storedSize(opfsName(url) + PART_SUFFIX)) ?? 0;
    const need = info.bytes - d.received;
    const est = await navigator.storage.estimate();
    const free = (est.quota ?? 0) - (est.usage ?? 0);
    if (free < need * 1.02) {
      throw new Error(`空き容量が足りません。あと ${mb(need)} 必要ですが、このブラウザで使えるのは ${mb(free)} です。`);
    }
    persisted = await navigator.storage.persist();
    await regionsDir(true);
    d.text = `${mb(d.received)} / ${mb(info.bytes)}`;
    const worker = new Worker(new URL(`./${__FILES__.downloadWorker}`, APP_URL));
    result = await new Promise((resolve) => {
      stop = () => resolve({ type: "cancelled" });
      worker.onmessage = (e: MessageEvent<DownloadEvent>) => {
        if (e.data.type === "progress") {
          d.received = e.data.received;
          d.text = `${mb(e.data.received)} / ${mb(e.data.total)}`;
          updateProgress(node.id);
        } else resolve(e.data);
      };
      worker.onerror = (e) => resolve({ type: "error", message: `ダウンロードに失敗しました: ${e.message}` });
      worker.postMessage({ type: "start", url, bytes: info.bytes } satisfies DownloadRequest);
      rerender();
    });
    worker.terminate();
    if (result.type === "error" && !result.message.startsWith("ダウンロードに失敗")) {
      result = { type: "error", message: `ダウンロードに失敗しました: ${result.message}` };
    }
  } catch (e) {
    result = { type: "error", message: e instanceof Error ? e.message : String(e) };
  }
  if (result.type !== "done") {
    active.delete(node.id);
    if (result.type === "error") failed.set(node.id, result.message);
    rerender();
    return;
  }
  d.received = info.bytes;
  d.text = "文字の形のデータを保存しています…";
  updateProgress(node.id);
  await prefetchGlyphs();
  if (!persisted) console.warn("navigator.storage.persist() was not granted; the browser may evict the download.");
  active.delete(node.id);
  if (seq === navSeq) await showMap(node);
  else if (document.body.dataset.view === "map") await joinMap();
  else rerender();
}

/**
 * Add newly downloaded regions to the map on screen without moving the
 * camera or reloading the style: point its source at the new set.
 */
async function joinMap() {
  if (!(await refreshLocal())) return;
  for (const [id, src] of Object.entries(map.getStyle().sources)) {
    if ("url" in src && src.url?.startsWith(`pmtiles://${LOCAL}`)) {
      map.getSource<VectorTileSource>(id)?.setUrl(`pmtiles://${LOCAL}${localGen}`);
    }
  }
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
  const seq = ++navSeq;
  setPickHandler(null);
  rememberLast(node.id);
  await refreshLocal();
  // Every region on the device, on one map; `node` only places the camera.
  const style = offlineStyle(await fetchStyle(), `${LOCAL}${localGen}`, MAPS_BASE);
  if (seq !== navSeq) return;
  const loaded = new Promise<void>((r) => map.once("style.load", () => r()));
  map.setStyle(style as unknown as StyleSpecification);
  if (node.bbox) map.fitBounds(node.bbox as [number, number, number, number], { padding: 8, duration: 0 });
  // Mark the view only once the region's style is in: until then the map
  // still holds the picker's style, which is already "loaded".
  await loaded;
  if (seq !== navSeq) return;
  document.body.dataset.view = "map";
  document.body.dataset.node = node.id;
  panel.replaceChildren();
  setMenu(false, node.name);
  // ☰ on the map opens the list the region was picked from, next to its siblings.
  const path = findPath(catalog, node.id) ?? [catalog];
  onMenu = () => void showSelection((path[path.length - 2] ?? path[0]).id);
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
