import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  // Bundle the workspace package so the published artifact is self-contained;
  // regular dependencies stay external and install from the registry.
  noExternal: ["@wind-tunnel/core"],
  // Native modules cannot be bundled — DuckDB ships per-platform prebuilt
  // binaries and must stay a runtime dependency of this package.
  external: ["@duckdb/node-api"],
  // The createRequire shim lets CJS transitive deps (bundled into this ESM
  // output) keep calling require() for node builtins — esbuild's __require
  // stub defers to a defined `require` instead of throwing.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __wtCreateRequire } from "node:module";',
      "const require = __wtCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  clean: true,
  sourcemap: false,
  minify: false,
});
