# Wind Tunnel

Generate and cluster synthetic opinions from hundreds of local AI personas — a CLI for testing messages before you publish.

Give it a draft (an ad, a post, an announcement). Wind Tunnel runs the text past a
demographically grounded pool of personas, collects their reactions, and maps the result:
backlash risk, what triggers whom, where opinion clusters form, and which rewrites defuse
the heat. A wind tunnel doesn't predict flight — it shows you the forces before you fly.

**Status: pre-alpha.** The pipeline runs end to end locally; packaging and
polish are in progress. See [docs/DESIGN.md](docs/DESIGN.md) for the
architecture.

## Quickstart

```
windtunnel doctor                  # check Ollama and the role models
windtunnel personas pull jp        # stream a persona pool (Hugging Face -> local pool)
windtunnel run "draft copy..."     # sample -> react -> analyze -> cluster -> suggest
```

A pull is fast: the datasets' rows are randomly distributed across their
parquet files, so the ingest streams only the columns it needs from only as
many files as it takes to fill every region's quota (Japan: ~20 s instead of
a 1.73 GB download).

Runs fully local against [Ollama](https://ollama.com), or hybrid with a cloud model for
the handful of analysis calls that benefit from a larger model. Results are written as
plain JSON / JSONL / CSV, so they drop straight into pandas, R, or a spreadsheet.

## Commands

### `windtunnel run "<message>"`

Runs the full pipeline and prints a live progress bar, then a summary
(backlash index, voice split, triggers, opinion groups, rewrite suggestions).

Audience selection:

| Option | Default | Meaning |
| --- | --- | --- |
| `--country <code>` | `jp` | persona pool: `jp` `usa` `in` `br` `fr` `kr` `vn` `be` (pull it first) |
| `--personas <n>` | `100` | how many personas react (1–1000) |
| `--region <name>` | nationwide | restrict to one region, e.g. `--region 関東地方`, `--region CA` |
| `--age-min / --age-max <n>` | none | age range filter |
| `--sex <M\|F>` | none | sex filter (normalized codes work for every country) |
| `--personas-file <path>` | — | use a custom JSON pool instead of the pulled one |

Framing:

| Option | Default | Meaning |
| --- | --- | --- |
| `--situation <id>` | `sns_viral` | where the personas are "speaking": `anon_board` (anonymous board, hottest), `sns_viral`, `news_comment`, `public_comment`, `real_sns` (real-name, measured), `consumer_survey` (neutral baseline) |
| `--context <text>` | none | background text shown to every persona alongside the message |
| `--output-lang <ja\|en>` | `ja` | language of the analysis output (reactions always come in the pool's language) |

Execution:

| Option | Default | Meaning |
| --- | --- | --- |
| `--batch <n>` | `5` | requests in flight for the batched stages (capped by the daemon's `OLLAMA_NUM_PARALLEL`, default 4) |
| `--profile <local\|hybrid>` | `local` | `hybrid` sends the ~4 analysis calls to Gemini (needs `GEMINI_API_KEY`) |
| `--model-bulk / --model-analysis / --model-premium <spec>` | qwen3 8B/14B | override a role model, e.g. `ollama:llama3.3`, `gemini:gemini-2.5-flash` |
| `--host <url>` | `http://localhost:11434` | Ollama daemon address |

Examples:

```
windtunnel run "採用告知のドラフト…" --personas 200 --situation anon_board
windtunnel run "Ad copy draft…" --country usa --region CA --age-min 18 --age-max 34
windtunnel run "…" --profile hybrid --output-lang en
```

### `windtunnel personas`

```
windtunnel personas pull <code>      # fetch a country preset into the local pool
windtunnel personas pull jp --cap 5000   # per-region sampling cap (default varies by country)
windtunnel personas list             # installed pools with size and version
```

### `windtunnel resume <run-id>`

Continues an interrupted run from its checkpoint. Reactions already generated
are never redone; completed stages are skipped. Also accepts a path to a run
directory.

### `windtunnel doctor`

Checks daemon reachability, whether the role models are installed (with the
exact `ollama pull` commands when not), what is loaded right now, and how to
raise daemon parallelism.

### `windtunnel init`

Interactive setup — writes `config.toml` so your defaults stick.

## Configuration

Settings resolve in this order: built-in defaults < `config.toml` < `WT_*`
environment variables < command-line flags.

`~/.config/wind-tunnel/config.toml` (see `windtunnel init`):

```toml
profile = "local"            # local | hybrid

[model]
bulk = "ollama:qwen3:8b"     # reactions & classification (~100+ calls)
analysis = "ollama:qwen3:14b" # verdict, propositions, group profiles (~3 calls)
premium = "ollama:qwen3:14b"  # rewrite suggestions (1 call)

[run]
country = "jp"
personas = 100
batch = 5
output_lang = "ja"

[ollama]
host = "http://localhost:11434"
```

Environment variables: `WT_PROFILE`, `WT_MODEL_BULK`, `WT_MODEL_ANALYSIS`,
`WT_MODEL_PREMIUM`, `WT_COUNTRY`, `WT_PERSONAS`, `WT_BATCH`, `WT_OUTPUT_LANG`,
`WT_SITUATION`, `WT_OLLAMA_HOST` (or `OLLAMA_HOST`), `GEMINI_API_KEY`.

## Run artifacts

Every run writes plain files under `~/.local/share/wind-tunnel/runs/<run-id>/`
(`$XDG_DATA_HOME` respected). This layout doubles as the resume checkpoint and
the machine-readable output:

| File | Contents |
| --- | --- |
| `input.json` | message, filters, models — everything needed to reproduce the run |
| `personas.json` | the sampled personas |
| `opinions.jsonl` | one reaction per line, appended as generated (`pandas.read_json(..., lines=True)`) |
| `scores.json` | per-opinion sentiment scores (-100..+100 with reasons) |
| `analyze.json` | verdict: backlash index, triggers, safe version |
| `cluster.json` | propositions, vote-matrix clusters, consensus/division, minority report |
| `suggest.json` | rewrite alternatives + common ground |
| `result.csv` | flat export for spreadsheets / R / SPSS (UTF-8 BOM, Excel-safe) |
| `status.json` | stage marker, timestamps, warnings |

## Persona data

Country presets build on NVIDIA's
[Nemotron-Personas datasets](https://huggingface.co/datasets?search=Nemotron-Personas)
(CC BY 4.0): Japan, USA, India, Brazil, France, Korea, Vietnam, Belgium.
Custom pools work today as JSON files via `--personas-file`; a TOML dataset
definition (map any CSV/parquet source) is planned.

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

To use the checkout as the `windtunnel` command: `cd packages/cli && npm link`.

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
