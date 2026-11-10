// Build dist/: the app as served from <maps>/offgrid/.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const version = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim() + "-" + Date.now().toString(36);
  } catch {
    return Date.now().toString(36);
  }
})();

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("public", "dist", { recursive: true });
cpSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "dist/maplibre-gl-worker.mjs");
writeFileSync(
  "dist/main.css",
  readFileSync("node_modules/maplibre-gl/dist/maplibre-gl.css", "utf8") + "\n" + readFileSync("src/app.css", "utf8"),
);

const common = { bundle: true, minify: true, sourcemap: true, target: "es2022", define: { __VERSION__: JSON.stringify(version) } };
await esbuild.build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.js", format: "esm" });
await esbuild.build({ ...common, entryPoints: ["src/sw.ts"], outfile: "dist/sw.js", format: "iife" });
await esbuild.build({ ...common, entryPoints: ["src/download-worker.ts"], outfile: "dist/download-worker.js", format: "iife" });
console.log(`built dist/ (${version})`);
