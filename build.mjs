// Build dist/: the app as served from <maps>/offgrid/.
//
// Everything except index.html, sw.js and the data files gets a content hash
// in its name. Cloudflare sits in front of the server and has been seen to
// keep serving an old main.js after a purge; with hashed names an old
// index.html still loads a consistent old set, as long as deploys do not
// delete old files (deploy with rsync without --delete).
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

/** Write `content` as dist/<name>-<hash>.<ext> and return that file name. */
function emitHashed(name, ext, content) {
  const file = `${name}-${hash(content)}.${ext}`;
  writeFileSync(`dist/${file}`, content);
  return file;
}

/** Bundle `entry` into memory and emit it hashed; returns the file name. */
async function bundle(entry, name, format, define) {
  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    target: "es2022",
    format,
    define,
    write: false,
    outfile: `dist/${name}.js`,
  });
  return emitHashed(name, "js", out.outputFiles[0].contents);
}

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("public", "dist", { recursive: true });

// Shipped as .js: nginx serves .mjs as application/octet-stream, and a module
// worker with a non-JavaScript type is refused.
const maplibreWorker = emitHashed("maplibre-gl-worker", "js", readFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"));
const css = emitHashed(
  "main",
  "css",
  readFileSync("node_modules/maplibre-gl/dist/maplibre-gl.css", "utf8") + "\n" + readFileSync("src/app.css", "utf8"),
);
const downloadWorker = await bundle("src/download-worker.ts", "download-worker", "iife", {});
const main = await bundle("src/main.ts", "main", "esm", {
  __FILES__: JSON.stringify({ maplibreWorker, downloadWorker }),
});

const index = readFileSync("public/index.html", "utf8").replace("./main.css", `./${css}`).replace("./main.js", `./${main}`);
if (index.includes("./main.css") || index.includes("./main.js")) throw new Error("index.html placeholders not replaced");
writeFileSync("dist/index.html", index);

// regions.json and every GeoJSON it names, so the picker works offline.
const geo = new Set();
(function walk(n) {
  for (const k of ["outline", "backdrop"]) if (n[k]) geo.add(`./${n[k]}`);
  (n.children ?? []).forEach(walk);
})(JSON.parse(readFileSync("public/regions.json", "utf8")));
for (const f of geo) readFileSync(`public/${f}`); // fail the build if one is missing

const shell = ["./", "./index.html", `./${main}`, `./${css}`, `./${downloadWorker}`, `./${maplibreWorker}`, "./regions.json", ...geo];
const version = hash(shell.join("\n"));
await esbuild.build({
  entryPoints: ["src/sw.ts"],
  bundle: true,
  minify: true,
  target: "es2022",
  format: "iife",
  outfile: "dist/sw.js",
  define: { __VERSION__: JSON.stringify(version), __SHELL__: JSON.stringify(shell) },
});
console.log(`built dist/ (${version}): ${shell.slice(2, 6).join(" ")} + ${shell.length - 6} data files`);
