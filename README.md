# Wind Tunnel

Simulate how hundreds of AI personas react to your message — locally, before you publish it.

Give it a draft (an ad, a post, an announcement). Wind Tunnel runs the text past a
demographically grounded pool of personas, collects their reactions, and maps the result:
backlash risk, what triggers whom, where opinion clusters form, and which rewrites defuse
the heat. A wind tunnel doesn't predict flight — it shows you the forces before you fly.

**Status: pre-alpha.** The pipeline runs end to end locally; packaging and
polish are in progress. See [docs/DESIGN.md](docs/DESIGN.md) for the
architecture.

## Usage (from a checkout)

```
windtunnel doctor                  # check Ollama and the role models
windtunnel personas pull jp        # stream a persona pool (Hugging Face -> local pool)
windtunnel run "draft copy..."     # sample -> react -> analyze -> cluster -> suggest
windtunnel resume <run-id>         # continue an interrupted run
windtunnel personas list           # show installed pools
windtunnel init                    # write config.toml interactively
```

A pull is fast: the datasets' rows are randomly distributed across their
parquet files, so the ingest streams only the columns it needs from only as
many files as it takes to fill every region's quota (Japan: ~20 s instead of
a 1.73 GB download).

Runs fully local against [Ollama](https://ollama.com), or hybrid with a cloud model for
the handful of analysis calls that benefit from a larger model. Results are written as
plain JSON / JSONL / CSV, so they drop straight into pandas, R, or a spreadsheet.

## Persona data

Country presets build on NVIDIA's
[Nemotron-Personas datasets](https://huggingface.co/datasets?search=Nemotron-Personas)
(CC BY 4.0): Japan, USA, India, Brazil, France, Korea, Vietnam, Belgium.
Custom pools can be plugged in via a TOML dataset definition.

## Docker

For Linux hosts with an NVIDIA GPU, `compose.yaml` bundles an Ollama service
with GPU passthrough:

```
docker compose up -d ollama
docker compose run --rm ollama-pull                      # fetch role models
docker compose run --rm windtunnel personas pull jp
docker compose run --rm windtunnel run "draft copy..."
```

On Apple Silicon, containers cannot reach the GPU — run Ollama and the CLI
natively instead. The image alone also suits CI/cloud runs pointed at a remote
`OLLAMA_HOST`.

## Development

Requires Node >= 20 and pnpm.

```
pnpm install
pnpm test          # unit suites; Ollama-dependent tests skip without a daemon
pnpm build         # bundles the CLI into packages/cli/dist
node packages/cli/dist/index.js doctor
```

Integration tests run automatically when a local Ollama daemon with
`qwen3:0.6b` is present. The live Hugging Face ingest test is opt-in:
`WT_TEST_HF=1 pnpm exec vitest run packages/core/tests/ingest-hf.test.ts`.

Release process: [docs/RELEASE.md](docs/RELEASE.md).

## License

[Apache-2.0](LICENSE). Bundled third-party code is listed with its license
texts in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) (all permissive:
Apache-2.0 / MIT / ISC / BSD-3-Clause). The Nemotron-Personas datasets are
CC BY 4.0 and are fetched by users directly from Hugging Face, not
redistributed here.
