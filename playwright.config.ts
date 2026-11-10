import { defineConfig, devices } from "@playwright/test";

const PORT = 8765;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}/static/maps/offgrid/`,
    // A phone-sized Chromium, the PoC's main target.
    ...devices["Pixel 7"],
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          // Headless Chromium has no GPU; SwiftShader provides the WebGL2 MapLibre needs.
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
          // With DISPLAY set (an SSH X11 forward, say), ANGLE tries to open an X
          // connection, fails, and the GPU process exits; getContext("webgl2")
          // then hangs the page instead of returning null.
          env: Object.fromEntries(
            Object.entries(process.env).filter(([k]) => k !== "DISPLAY" && k !== "WAYLAND_DISPLAY"),
          ) as Record<string, string>,
        },
      },
    },
  ],
  webServer: {
    command: `bash e2e/make-fixture.sh && node build.mjs && PORT=${PORT} node e2e/server.mjs`,
    url: `http://localhost:${PORT}/static/maps/offgrid/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
