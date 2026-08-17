# Commands & configuration

Status: Implemented
Last updated: 2026-08-17

The README covers the quickstart; this page is the full reference.

## `wt-cli run "<message>"`

Runs the full pipeline with a live view (recent voices + progress), then
replies with a summary built around the opinion groups: overall temperature
(backlash index, voice split), triggers, one card per group — its belief and
one or two real member voices — the minority's view of what the majority
overlooks, and rewrite suggestions. When the crowd is effectively unanimous
(no substantial clustering structure), it is honestly presented as one camp.

Audience selection:

| Option | Default | Meaning |
| --- | --- | --- |
| `--country <code>` | `usa` | persona pool: `jp` `usa` `in` `br` `fr` `kr` `vn` `be` (pull it first) |
| `--personas <n>` | `100` | how many personas react (1–1000) |
| `--region <name>` | nationwide | restrict to one region, e.g. `--region CA`, `--region 関東地方` |
| `--age-min / --age-max <n>` | none | age range filter |
| `--sex <M\|F>` | none | sex filter (normalized codes work for every country) |
| `--personas-file <path>` | — | use a custom JSON pool instead of the pulled one |

Framing:

| Option | Default | Meaning |
| --- | --- | --- |
| `--situation <id>` | `sns_viral` | where the personas are "speaking": `anon_board` (anonymous board, hottest), `sns_viral`, `news_comment`, `public_comment`, `real_sns` (real-name, measured), `consumer_survey` (neutral baseline) |
| `--context <text>` | none | background text shown to every persona alongside the message |
| `--output-lang <ja\|en>` | follows country | language of the analysis output (reactions always come in the pool's language) |

Execution:

| Option | Default | Meaning |
| --- | --- | --- |
| `--batch <n>` | `5` | requests in flight for the batched stages (capped by the daemon's `OLLAMA_NUM_PARALLEL`, default 4) |
| `--profile <local\|hybrid>` | `local` | `hybrid` sends the ~4 analysis calls to Gemini (needs `GEMINI_API_KEY`) |
| `--model-bulk / --model-analysis / --model-premium <spec>` | qwen3 8B/14B | override a role model, e.g. `ollama:llama3.3`, `gemini:gemini-2.5-flash` |
| `--host <url>` | `http://localhost:11434` | Ollama daemon address |

Examples:

```
wt-cli run "Ad copy draft…" --region CA --age-min 18 --age-max 34
wt-cli run "採用告知のドラフト…" --country jp --personas 200 --situation anon_board
wt-cli run "…" --profile hybrid
```

## `wt-cli detail [run-id]`

The drill-down behind the summary: the proposition × group agreement table
(consensus rows marked) and every voice in full — score, group, persona, the
reaction, and the scorer's reasoning — sorted most-critical first. Defaults to
the latest run; `--group <n>` narrows to one group. Pipes cleanly:
`wt-cli detail | less`.

## `wt-cli personas`

```
wt-cli personas pull <code>          # fetch a country preset into the local pool
wt-cli personas pull usa --cap 800   # per-region sampling cap (default varies by country)
wt-cli personas list                 # installed pools with size and version
```

A pull streams only the needed columns from Hugging Face and stops as soon as
every region's quota is filled — tens of seconds instead of a full dataset
download.

## `wt-cli resume <run-id>`

Continues an interrupted run from its checkpoint. Reactions already generated
are never redone; completed stages are skipped. Also accepts a path to a run
directory.

## `wt-cli doctor`

Checks daemon reachability, whether the role models are installed (with the
exact `ollama pull` commands when not), what is loaded right now, and how to
raise daemon parallelism.

## `wt-cli init`

Interactive setup — writes `config.toml` so your defaults stick.

## Configuration

Settings resolve in this order: built-in defaults < `config.toml` < `WT_*`
environment variables < command-line flags.

`~/.config/wind-tunnel/config.toml` (see `wt-cli init`):

```toml
profile = "local"             # local | hybrid

[model]
bulk = "ollama:qwen3:8b"      # reactions & classification (~100+ calls)
analysis = "ollama:qwen3:14b" # verdict, propositions, group profiles (~3 calls)
premium = "ollama:qwen3:14b"  # rewrite suggestions (1 call)

[run]
country = "usa"
personas = 100
batch = 5
output_lang = "en"            # defaults to the pool country's language (jp -> ja, others -> en)

[ollama]
host = "http://localhost:11434"
```

Environment variables: `WT_PROFILE`, `WT_MODEL_BULK`, `WT_MODEL_ANALYSIS`,
`WT_MODEL_PREMIUM`, `WT_COUNTRY`, `WT_PERSONAS`, `WT_BATCH`, `WT_OUTPUT_LANG`,
`WT_SITUATION`, `WT_OLLAMA_HOST` (or `OLLAMA_HOST`), `GEMINI_API_KEY`,
`WT_DEBUG` (set to 1 for full stack traces and version info on errors).

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
