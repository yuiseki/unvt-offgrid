/// <reference lib="webworker" />
/**
 * Service worker.
 *
 * - `*.pmtiles`: if the archive has been downloaded into OPFS, answer Range
 *   requests by slicing that file. Otherwise let the request go to the network.
 * - The app itself (this worker's scope): stale-while-revalidate, precached on
 *   install, so the page opens offline.
 * - Map assets next to the app (style, sprites, glyphs under ../): cache-first.
 *   The style and sprites are precached; glyphs are cached as they are used
 *   and prefetched by the page after a region download.
 */
import { parseRange } from "./range";
import { OPFS_DIR, opfsName } from "./regions";
import { ASSET_CACHE, SHELL_FILES, assetUrls } from "./assets";

declare const __VERSION__: string;
const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL_CACHE = `offgrid-shell-${__VERSION__}`;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      // addAll fails the install if any file is missing: better than an app
      // that half works offline.
      await shell.addAll(SHELL_FILES);
      const assets = await caches.open(ASSET_CACHE);
      await assets.addAll(assetUrls(sw.registration.scope));
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("offgrid-shell-") && name !== SHELL_CACHE) await caches.delete(name);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith(".pmtiles")) {
    event.respondWith(fromOpfs(req).then((r) => r ?? fetch(req)));
    return;
  }
  const scope = sw.registration.scope;
  if (req.url.startsWith(scope)) {
    event.respondWith(staleWhileRevalidate(req, event));
    return;
  }
  if (req.url.startsWith(new URL("../", scope).href)) {
    event.respondWith(cacheFirst(req));
  }
});

async function fromOpfs(req: Request): Promise<Response | null> {
  let file: File;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR);
    file = await (await dir.getFileHandle(opfsName(req.url))).getFile();
  } catch {
    return null;
  }
  // No ETag on purpose: pmtiles.js rejects a response whose ETag differs from
  // the one it saw first, and the first one may have come from the network.
  const base = { "Accept-Ranges": "bytes", "Content-Type": "application/octet-stream", "X-Offgrid": "opfs" };
  const range = parseRange(req.headers.get("Range"), file.size);
  if (range === null) {
    return new Response(file, { status: 200, headers: { ...base, "Content-Length": String(file.size) } });
  }
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${file.size}` } });
  }
  return new Response(file.slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      ...base,
      "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
      "Content-Length": String(range.end - range.start + 1),
    },
  });
}

async function staleWhileRevalidate(req: Request, event: FetchEvent): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then(async (res) => {
    if (res.ok) await cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  try {
    return await network;
  } catch (e) {
    if (req.mode === "navigate") {
      const index = await cache.match("./index.html");
      if (index) return index;
    }
    throw e;
  }
}

async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}
