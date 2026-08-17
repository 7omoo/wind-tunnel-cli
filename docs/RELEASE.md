# Release checklist

Status: Draft
Last updated: 2026-08-17

The package is publish-ready except for the deliberate blockers below.
`packages/cli/package.json` keeps `"private": true` as the safety catch —
remove it only as part of executing this checklist.

## Blockers (decide before the first release)

1. **License.** Choose and add `LICENSE`, set the `license` field in
   `packages/cli/package.json` and `packages/core/package.json`, and update the
   README's License section. All runtime dependencies are permissive
   (Apache-2.0 / MIT / BSD); no copyleft constraints force a choice.
2. **Tagline.** Final one-line description (package.json `description`, README
   intro, GitHub repo description).

## Publish steps (npm)

```
# from a clean main with CI green
pnpm install && pnpm check && pnpm typecheck && pnpm test && pnpm build

# dry run: verify the tarball contains dist/ + manifest only
cd packages/cli && npm publish --dry-run

# remove "private": true from packages/cli/package.json, then
npm publish            # first publish claims the name `wind-tunnel`
git tag v0.1.0 && git push --tags
```

Notes:

- The published package is `wind-tunnel` (bin: `windtunnel`). The name was
  confirmed unclaimed on npm on 2026-08-17 — claim it with the first publish;
  don't sit on it.
- `@wind-tunnel/core` stays private and unbublished: the CLI bundle compiles it
  in (tsup `noExternal`), so it is a devDependency and never reaches the
  registry. Runtime deps of the published package are exactly:
  `@duckdb/node-api` (native, per-platform prebuilds), `commander`,
  `smol-toml`, `zod`.
- Standalone execution of `dist/` + those four deps is verified by the same
  assembly the Dockerfile uses (dist + stripped manifest + `npm install
  --omit=dev`).

## Publish steps (container image)

```
docker build -t ghcr.io/7omoo/wind-tunnel-cli:v0.1.0 .
docker push ghcr.io/7omoo/wind-tunnel-cli:v0.1.0
```

(Or add a tag-triggered workflow later; not wired yet on purpose — first
releases benefit from a human at the wheel.)

## Post-release

- GitHub repo public + topics: `llm` `ollama` `persona` `simulation`
  `synthetic-audience` `marketing`
- Verify `npx wind-tunnel doctor` works on a machine that has never seen the
  repo
- README quickstart against the published package instead of the checkout
