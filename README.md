# unvt-offgrid

Download a region's vector tiles into a smartphone browser while online, then
use the map offline. The region is one PMTiles archive cut from a planet
archive; it is stored in the browser's Origin Private File System (OPFS).

Live: https://z.yuiseki.net/static/maps/offgrid/ (PoC: World > Japan > Kanto, then the whole of Kanto or one of its seven prefectures)

## How it works

```
first visit (online)                       later (offline)
---------------------                      ----------------
pick a region on a map                     index.html, code, style, sprites,
  World > Japan > Kanto                    glyphs: from the service worker's cache
download worker streams                    MapLibre -> pmtiles.js -> fetch(Range)
  kanto-251124.pmtiles  --> OPFS              -> service worker slices the OPFS file
  (sync access handle, resumable)          tiles the archive lacks -> ocean tile
```

- **Region picker** (`src/main.ts`): Natural Earth outlines drawn with MapLibre,
  and a list under the ☰ menu (top left, folds away). Tapping a name or an
  outline goes into that region; the ↓ next to a name downloads it in place,
  and becomes 地図 once the region is on the device. On the map, ☰ opens the
  list the region was picked from. A child
  with its parent's outline (the whole of Kanto) is only in the list, so it does
  not cover its siblings on the map. Several regions can be kept; the one
  opened last comes up on start.
- **Download** (`src/download-worker.ts`): a dedicated worker writes the
  archive in place through `createSyncAccessHandle()` into `regions/NAME.part`,
  and resumes an interrupted download with `Range: bytes=N-`. Only a complete
  file whose size matches the catalogue and whose header says PMTiles v3 is
  renamed to `regions/NAME`. Before starting, `navigator.storage.estimate()`
  must show enough free quota, and `navigator.storage.persist()` is requested.
- **Serving** (`src/sw.ts`): a request for any `*.pmtiles` whose file name is in
  OPFS is answered from that file (206 with `Content-Range`, no ETag). The app
  shell is precached; the style, sprites and a fixed set of glyph ranges are
  cached under `offgrid-assets`.
- **One map for every region**: the style has a single source,
  `pmtiles://offgrid-local-N`, which the protocol handler answers from every
  archive on the device: the first archive whose bounds overlap the tile and
  that has it. Archives cut from the same planet hold identical copies of the
  tiles along shared borders (checked on Tokyo/Kanagawa, Tokyo/Chiba and
  Chiba/Ibaraki at z8, z12 and z14), so the regions join without a seam.
  Archives from different planet dates would not join cleanly.
- **The sea around the region**: the archive is cut to the region's polygon, so
  it has no tiles over the surrounding sea. The OpenMapTiles schema has no land
  layer (land is the background colour), so missing tiles would look like land.
  The pmtiles protocol handler answers every missing tile with the planet's
  open-ocean tile (`src/tiles.ts`, 58 bytes), and the TileJSON bounds are
  widened to the world. Land outside the region is drawn as sea too.
- **Glyphs**: MapLibre draws CJK ideographs and kana with a local font, so only
  five ranges per font stack are needed (1.2 MB for the three stacks of
  osm-bright), recorded with `e2e/record-glyphs.spec.ts`.
- **Safari** gets a warning: it may evict OPFS after seven days without a
  visit. Whether Chrome on iOS behaves the same is unverified (see TODO.md).

## Layout on the server

```
/static/maps/offgrid/                      this app (dist/)
/static/maps/styles/osm-bright.json        shared with other pages
/static/maps/sprites/, /static/maps/fonts/
/static/openstreetmap/regions/asia/japan/kanto/kanto-251124.pmtiles
/static/openstreetmap/regions/asia/japan/kanto/prefectures/NAME-251124.pmtiles
```

The archive URL in `regions.json` is relative, so the app and the archives must
stay on the same origin (the service worker only answers same-origin requests).

## Develop

```bash
npm install
npm run typecheck
npm test             # unit tests (vitest)
npm run e2e          # Playwright, phone-sized Chromium; builds dist/ and serves it
npm run build        # dist/
```

The e2e server (`e2e/server.mjs`) lays files out like the production server and
uses the same MIME types as its nginx. It needs the published style, sprites
and fonts (`MAPS_DIR`, required) and builds
a small stand-in for the Kanto archive (zoom 0-6) with `e2e/make-fixture.sh`.

Headless Chromium gets WebGL2 from SwiftShader. If `DISPLAY` is set (an SSH X11
forward, say) ANGLE tries to open an X connection, the GPU process exits and
`getContext("webgl2")` hangs; the Playwright config removes `DISPLAY`.

## Build data

```bash
# outlines for the picker, and the polygons archives are cut to
scripts/build-geo.sh /path/to/natural-earth-10m-shapefiles
# Kanto, cut along its polygon (z0-14)
scripts/build-region.sh planet.pmtiles regions/kanto.geojson kanto-251124.pmtiles
# the seven prefectures of Kanto
scripts/build-kanto-prefectures.sh /path/to/natural-earth-10m-shapefiles planet.pmtiles OUTDIR 251124
```

Natural Earth is public domain. The tiles are OpenMapTiles schema from
OpenStreetMap data, © OpenStreetMap contributors, ODbL.

## Deploy

```bash
npm run build
rsync -a dist/ WEB_ROOT/static/maps/offgrid/   # no --delete
```

Cloudflare is in front of the server. Code files carry a content hash in their
names, so an `index.html` that Cloudflare still serves from before a deploy
loads its own, consistent set of files. Keep old files for that reason. The
worker is shipped as `.js` because nginx serves `.mjs` as
`application/octet-stream`, which the browser refuses for a module worker.
