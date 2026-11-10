// Static server for the e2e tests, laid out like z.yuiseki.net/static/:
//
//   /static/maps/offgrid/...   dist/ (the app)
//   /static/maps/...           MAPS_DIR (published style, sprites, fonts)
//   /static/openstreetmap/regions/asia/japan/kanto/**.pmtiles
//                              REGION_FILE (a small stand-in archive)
//
// regions.json is rewritten so each archive size matches the file served.
// POST /__cut?after=N makes the next archive download stop after N bytes,
// to test resuming. POST /__slow?ms=M sends the next archive download in
// 64 kB pieces, M ms apart, to test what happens while one is running.
// GET /__log returns and clears the request log.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 8765);
const DIST = process.env.DIST ?? "dist";
const MAPS_DIR = process.env.MAPS_DIR;
if (!MAPS_DIR || !existsSync(join(MAPS_DIR, "styles/osm-bright.json"))) {
  console.error("Set MAPS_DIR to a directory with styles/osm-bright.json, sprites/ and fonts/.");
  process.exit(1);
}
const REGION_FILE = process.env.REGION_FILE ?? "e2e/fixtures/kanto-z6.pmtiles";
const REGION_DIR = "/static/openstreetmap/regions/asia/japan/kanto/";

// Same as the production nginx, which has no entry for .mjs (served as
// application/octet-stream, and a module worker with that type will not load).
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/octet-stream",
  ".map": "application/json",
};

let cutAfter = null;
let slowMs = null;
let log = [];

function resolve(pathname) {
  // Archives under Kanto: e2e/fixtures/NAME-box.pmtiles if there is one for
  // that prefecture, else the Kanto-wide stand-in.
  if (pathname.startsWith(REGION_DIR) && pathname.endsWith(".pmtiles")) {
    const name = pathname.slice(pathname.lastIndexOf("/") + 1).replace(/-\d+\.pmtiles$/, "");
    const box = join(dirname(REGION_FILE), `${name}-box.pmtiles`);
    return existsSync(box) ? box : REGION_FILE;
  }
  const p = normalize(decodeURIComponent(pathname));
  if (p.startsWith("/static/maps/offgrid/")) {
    const rest = p.slice("/static/maps/offgrid/".length) || "index.html";
    return join(DIST, rest);
  }
  if (p.startsWith("/static/maps/")) return join(MAPS_DIR, p.slice("/static/maps/".length));
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/__cut") {
    cutAfter = Number(url.searchParams.get("after"));
    return res.end("ok");
  }
  if (url.pathname === "/__slow") {
    slowMs = Number(url.searchParams.get("ms"));
    return res.end("ok");
  }
  if (url.pathname === "/__log") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(log));
    log = [];
    return;
  }
  log.push({ path: url.pathname, range: req.headers.range ?? null });

  const file = resolve(url.pathname);
  if (!file || !existsSync(file) || statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end("not found");
  }
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");

  if (url.pathname.endsWith("/offgrid/regions.json")) {
    const cat = JSON.parse(readFileSync(file, "utf8"));
    const walk = (n) => {
      if (n.pmtiles) n.pmtiles.bytes = statSync(resolve(new URL(n.pmtiles.url, url).pathname)).size;
      (n.children ?? []).forEach(walk);
    };
    walk(cat);
    return res.end(JSON.stringify(cat));
  }

  const size = statSync(file).size;
  res.setHeader("Accept-Ranges", "bytes");
  let start = 0;
  let end = size - 1;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (m) {
    start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.setHeader("Content-Length", String(end - start + 1));

  if (file === REGION_FILE && cutAfter !== null && !m?.[2]) {
    // An open-ended download: send `cutAfter` bytes, then drop the connection.
    const n = cutAfter;
    cutAfter = null;
    const stream = createReadStream(file, { start, end: Math.min(end, start + n - 1) });
    stream.on("end", () => setTimeout(() => res.destroy(), 50));
    return stream.pipe(res, { end: false });
  }
  if (url.pathname.startsWith(REGION_DIR) && slowMs !== null && !m?.[2]) {
    const ms = slowMs;
    slowMs = null;
    const stream = createReadStream(file, { start, end, highWaterMark: 64 * 1024 });
    stream.on("data", (chunk) => {
      res.write(chunk);
      stream.pause();
      setTimeout(() => stream.resume(), ms);
    });
    stream.on("end", () => res.end());
    res.on("close", () => stream.destroy());
    return;
  }
  createReadStream(file, { start, end }).pipe(res);
}).listen(PORT, () => console.log(`e2e server on http://localhost:${PORT}/static/maps/offgrid/`));
