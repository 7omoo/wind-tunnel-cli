# Release checklist

Status: Draft
Last updated: 2026-08-17

The package is publish-ready (the `"private": true` safety catch was removed
2026-08-17 as part of publish prep; the remaining gate is a human running the
steps below).

## Blockers (decide before the first release)

1. ~~License.~~ **Resolved 2026-08-17: Apache-2.0.** `LICENSE` (canonical
   text), `NOTICE`, and `THIRD_PARTY_LICENSES.md` are in place; both package
   manifests carry the `license` field. The dependency audit found only
   permissive licenses (bundled: Apache-2.0 ×7, MIT ×14, ISC ×1; runtime:
   MIT ×5, BSD-3-Clause ×1 — zero copyleft). Regenerate the third-party file
   after dependency changes: `node scripts/generate-third-party-notices.mjs`.
2. ~~Tagline.~~ **Resolved 2026-08-17:** "Generate and cluster synthetic
   opinions from hundreds of local AI personas — a CLI for testing messages
   before you publish." Applied to package.json, README, and the GitHub repo
   description. Descriptive over metaphorical by decision — the wind-tunnel
   metaphor lives in the README body, not the tagline.

No blockers remain — publishing is now just the steps below.

## Versioning policy (alpha = 0.x, decided 2026-08-17)

Plain SemVer with major version zero. `0.x` **is** the alpha signal — the
SemVer spec reserves it for initial development ("anything MAY change"), and
the npm ecosystem reads it that way. No `-alpha.N` suffixes and no `alpha`
dist-tag: that machinery exists for shipping previews *alongside* a stable
line, and with no stable line yet it would only break `npx wind-tunnel-cli`
(which installs `latest`).

While on 0.x:

- **patch** (0.1.1) — bug fixes, doc/message tweaks
- **minor** (0.2.0) — features, and any change to the public contract:
  flags, summary output, run-artifact schemas (`schemaVersion`), config.toml
- **1.0.0** — a promise, not a milestone: the contract above freezes and
  breaking changes start costing a major. Not before real-world usage.

Mechanics: `npm version patch|minor` (run in `packages/cli/`) bumps the
manifest and creates the commit + matching `vX.Y.Z` tag in one step; then
publish and `git push --follow-tags`. Keep the npm version and the git tag
identical, always.

Published versions are immortal: npm blocks unpublish after 72 hours and a
released number can never be reused. A bad release is fixed by the next
patch, never by overwriting.

Changelog = GitHub Releases (`gh release create vX.Y.Z --generate-notes`,
then edit). No CHANGELOG.md file to maintain in-repo.

## Publish steps (npm)

```
# from a clean main with CI green
pnpm install && pnpm check && pnpm typecheck && pnpm test && pnpm build

# dry run: verify the tarball contains dist/ + manifest only
cd packages/cli && npm publish --dry-run

npm publish            # first publish claims the name `wind-tunnel-cli`
git tag -a v0.1.0 -m "v0.1.0" && git push --follow-tags
gh release create v0.1.0 --generate-notes
```

(From the second release on, `npm version patch|minor` replaces the manual
bump + tag — see the versioning policy above.)

Notes:

- The published package is `wind-tunnel-cli` (bin: `wt-cli`), matching the
  repo. The first choice `wind-tunnel` was rejected by the registry at publish
  time (E403, moniker rule: too similar to the existing `windtunnel`) even
  though `npm view` showed it unclaimed — renamed 2026-08-17. `npx <package>`
  still runs `wt-cli`: with a single bin, npx executes it regardless of name.
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
- Verify `npx wind-tunnel-cli doctor` works on a machine that has never seen the
  repo
- README quickstart against the published package instead of the checkout
