import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  // Bundle the workspace package so the published artifact is self-contained;
  // regular dependencies stay external and install from the registry.
  noExternal: ["@wind-tunnel/core"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  sourcemap: false,
  minify: false,
});
