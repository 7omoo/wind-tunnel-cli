# Wind Tunnel CLI — Design

Status: Implemented (v0.1)
Last updated: 2026-10-06

This document records the architecture decisions behind the CLI.
When code and this document disagree, code wins and this document gets updated.

---

## 1. What this is

A standalone CLI that runs the wind-tunnel reaction pipeline end to end on a local
machine: take one message, show it to N synthetic personas, collect their reactions,
and return an opinion map (backlash index, triggers, opinion clusters,
consensus/division points, rewrite suggestions).

The engine is extracted from the hosted wind-tunnel app. The extraction is a copy,
not a live dependency: the CLI repo owns its code. If the two drift, prompts and
analysis logic may be re-unified later by making this package the upstream
(open-core inversion). Until then, sync is manual and deliberate.

Primary target: fully local execution against [Ollama](https://ollama.com).
Secondary: a hybrid profile that keeps the ~4 heavy analysis calls on a cloud model.

## 2. Fixed decisions

| Topic | Decision |
| --- | --- |
| Language | TypeScript (ESM, strict, `noUncheckedIndexedAccess`) |
| Package manager | pnpm workspace |
| Packages | `packages/core` (engine, private) + `packages/cli` (npm: `wind-tunnel-cli`) |
| Binary name | `wt-cli` (user decision 2026-08-17). `wt` is off-limits (Windows Terminal's `wt.exe`). Accepted risk: Auth0's discontinued webtask CLI (npm package `wt-cli`, last publish 2023) also ships a `wt-cli` bin, so global installs collide on the few machines that still have it. The npm package is `wind-tunnel-cli`, matching the repo (`wt-cli` is taken on the registry; unscoped `wind-tunnel` was rejected at first publish, 2026-08-17 — npm's moniker rule flagged it as too similar to the existing `windtunnel`) |
| Publishing | Single npm package `wind-tunnel-cli`; core is bundled in via tsup (`noExternal`) |
| Distribution | npm first (`npx wind-tunnel-cli`); Docker image second (Linux servers / CI); single binary later (DuckDB is a native dependency of both ingest and pool sampling) |
| Lint/format | Biome, line width 100, double quotes |
| Tests | Vitest, five layers (unit / mocked pipeline / in-process commands / black-box E2E over an Ollama stub / self-skipping live integration) — see docs/testing.md |
| No web framework | No Next.js, no HTTP server, no SSE — the pipeline is plain async functions and generators |

## 3. Pipeline

Five stages, same shape as the hosted app, minus HTTP:

```
1 filter      pick N personas from the local pool (DuckDB; WHERE + random sample)
2 react       each persona reacts to the message           [bulk model, batched]
3a analyze    per-opinion scores -> verdict/triggers/safe version
              scores: batched                              [bulk model]
              verdict: single call on a budgeted sample    [analysis model]
3b cluster    propositions -> vote matrix -> PCA -> k-means
              -> consensus / division / bridging / minority
              propositions & profiles: analysis model; stances: bulk, batched
4 suggest     alternative rewrites + common ground         [premium model, 1 call]
```

Approximate model calls at N=100: ~115 bulk (100 react + 4 score + 10 stance + 1
axis labels), 3 analysis, 1 premium. The design
principle carried over from the original app: almost everything rides on a small,
cheap model; only a handful of calls need a strong one. That ratio is what makes
full-local viable.

Clustering carries an honesty rule: when the best silhouette score falls below
0.25 (Kaufman & Rousseeuw's "no substantial structure" threshold), the forced
k>=2 split collapses to a single group — a unanimous crowd is reported as one
camp instead of two factions with identical beliefs. Division and bridging are
between-group measures and are skipped in that case.

A proposition counts as consensus only when every group's agree rate is at
least 0.6 (with one group, that group alone) — the hosted app's definition.
Ranking by the product of the rates alone would let a proposition two groups
reject still head the list; when nothing clears the bar, consensus is empty.
The suggest stage's common ground ("all groups share ...") is left empty then
too, rather than letting the model assert agreement no proposition shows.

Stages run strictly in sequence (verdict, then cluster, then suggest); only the
work inside a stage is batched. Stage 2 emits opinions through an async generator; the CLI
consumes it for progress display and appends each opinion to the run's JSONL
checkpoint as it arrives.

## 4. Large-N strategy

The original app sends all opinions to the analyzer in one prompt. That breaks on
local models (context overflow is silent in some paths) and gets slow in the cloud.
The CLI restructures stage 3a:

1. **Scores first, batched.** Per-opinion sentiment scores (-100..+100 + one-line
   reason) are produced in batches of ~25 opinions per call on the bulk model,
   in parallel. Each opinion is independent; this scales to any N. The model
   returns a stance and an unsigned intensity per reaction, in prompt order;
   the sign is composed in code and entries map back to personas by position
   (no persona ids in the schema, so every batch of a given size shares one
   schema).
2. **Verdict on a budgeted sample.** The verdict call (backlash index, triggers,
   safe version) receives aggregate statistics from step 1 plus a stratified
   sample of raw opinions (most critical, most favorable, random neutral) that
   fits a fixed context budget. At N <= ~150 the "sample" is simply all opinions,
   which reproduces the original behavior. The output stays bounded too: each
   trigger cites at most 5 representative reactions (`sampleOpinionIds`) while
   `count` carries how many object, so completion length does not grow with N.
3. **Propositions from a sample, stances for all.** Proposition extraction (3b)
   reads a stratified sample; stance classification then runs every opinion
   against the propositions in batches of 10 (unchanged from the original).

Context budgets per stage (fixed in `models/stages.ts`):

| Stage | num_ctx | Parallelism |
| --- | --- | --- |
| react | 4096 | user batch setting |
| score batches | 8192 | user batch setting |
| stance batches | 8192 | user batch setting |
| axis labels | 8192 | 1 (alongside profiles) |
| verdict / propositions / profiles | 32768 | 1 |
| suggest | 16384 | 1 |

## 5. Model layer

Three roles, resolved from `provider:model` strings (same scheme as the original):

| Role | Used by | Default (local profile) |
| --- | --- | --- |
| `bulk` | react, score batches, stance batches, axis labels | `ollama:qwen3:8b` (subject to eval) |
| `analysis` | verdict, propositions, group profiles | `ollama:qwen3:14b` (subject to eval) |
| `premium` | suggest | same as analysis |

Providers: `ollama:` (default), `lmstudio:` (alternative local server),
`gemini:` (hybrid), extensible to others.

**Ollama access goes through a native provider, not the OpenAI-compat endpoint.**
Two documented failure modes force this:

- The OpenAI-compat path cannot set `num_ctx` per request; prompts silently
  truncate at the daemon default. A truncated verdict prompt doesn't error —
  it produces a confident analysis of a fraction of the input.
- The OpenAI-compat path ignores `response_format: json_schema`. The native
  `format` parameter gives real constrained decoding, which small local models
  need to return parseable JSON reliably.

The native provider lets each stage pass `num_ctx`, `format` (the stage's own
strict Zod generation schema, converted by the AI SDK), and `keep_alive`.
Generation schemas live with their stages because most depend on the call
(batch size, proposition and cluster counts); outputs are then mapped into the
domain types in `types.ts`, with shared enums in `schemas.ts`.

**LM Studio goes through its OpenAI-compatible endpoint** (`@ai-sdk/openai-compatible`
with structured outputs) — unlike Ollama's compat path, LM Studio's enforces
`response_format: json_schema`, and there is no native AI SDK provider. Two
differences from Ollama shape the integration:

- Context length is fixed when the model is loaded, not per request, so every
  LM Studio model must be loaded with the largest stage budget
  (`LMSTUDIO_MIN_CONTEXT`, from `STAGE_NUM_CTX`); `run` and `doctor` verify it.
- Thinking cannot be turned off per request
  ([lmstudio-bug-tracker#1990](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1990)),
  and on structured calls the constrained answer lands in `reasoning_content`
  ([#1773](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1773),
  [#1971](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1971)).
  A middleware (`lmstudio/reasoning-workaround.ts`, TODO to remove) recovers it
  for JSON calls only; non-thinking models are recommended.
- After any unstructured request, the next structured request is answered
  without the schema applied (the following one conforms) — in a run, the
  first score call right after react
  ([lmstudio-bug-tracker#2476](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2476)).
  A second middleware (`lmstudio/structured-output-retry.ts`, TODO to remove)
  regenerates once when a JSON answer is not JSON or lacks the schema's
  required keys; zod still validates the result.
- Each new schema costs a grammar compile on first use (up to ~60 s observed),
  which is one reason score entries map by position rather than per-batch id
  enums (§4).

**Profiles** bundle the choices:

- `local` — everything on Ollama. Offline.
- `hybrid` — bulk on Ollama, analysis/premium on Gemini. ~4 metered calls per run.

**Embeddings are deliberately absent in v1.** The opinion map is computed by PCA
over the vote matrix (stances on propositions), which needs no embeddings. An
optional embedding-based scatter (via Ollama embedding models) can come later.

## 6. Batching and Ollama operations

One user-facing `batch` setting drives a shared batch executor used by react,
score, and stance stages. Two things the CLI must surface because users cannot
see them:

- **Effective parallelism is `min(batch, OLLAMA_NUM_PARALLEL)`.** The daemon
  default is low (typically 4, or 1 on constrained machines), and the HTTP API
  does not expose the setting — so it cannot be read, only stated. `doctor`
  prints the defaults and the exact `ollama serve` invocation to change them.
- **KV cache cost = slots x num_ctx.** Keeping react at 4096 is what allows
  high parallelism; the 32K stages run single-slot. The CLI never asks the daemon
  for a global context length.

The CLI never starts or configures the daemon itself — daemon-level settings only
apply at `ollama serve` time, and silently "fixing" them from a child process is
impossible anyway. Diagnose and instruct, don't manage.

## 7. Persona data

### Presets (v1)

Eight countries backed by NVIDIA Nemotron-Personas datasets on Hugging Face
(CC BY 4.0, ungated):

| Code | Dataset | Geo column(s) | Reaction language |
| --- | --- | --- | --- |
| jp | Nemotron-Personas-Japan | region / prefecture | ja |
| usa | Nemotron-Personas-USA | state / city | en |
| in | Nemotron-Personas-India | state / district | en |
| br | Nemotron-Personas-Brazil | state / municipality | pt |
| fr | Nemotron-Personas-France | departement / commune | fr |
| kr | Nemotron-Personas-Korea | province / district | ko |
| vn | Nemotron-Personas-Vietnam | region / zone | vi |
| be | Nemotron-Personas-Belgium | region / municipality | en |

Singapore and El Salvador exist upstream but are out of v1 (different geo schema;
easy to add as presets later). The hosted app's self-generated Malaysia pool is
not on Hugging Face and is not part of the CLI.

### Ingest

`wt-cli personas pull <code>` queries the dataset directly with DuckDB
(`@duckdb/node-api`) over the `hf://` protocol, projecting only the ~12 needed
columns (the long free-text persona variants are skipped), stratified-samples
by region with a per-region cap, validates (region match rate against the known
set for jp/usa, null checks), and swaps the result transactionally into a local
**DuckDB pool file** (`<data>/wind-tunnel/personas.duckdb` — DuckDB rather than
SQLite so ingest and sampling share one native dependency; runs open it
read-only). The gate was verified by measurement (2026-08-17): rows are randomly
distributed across the dataset's parquet files (per-file region shares match the
whole-dataset shares), so the ingest reads files one at a time, takes only each
region's remaining deficit, and stops as soon as every region is filled — the
Japan preset fills from 1 of its 8 files in ~20 s instead of a 1.73 GB download.

### Custom datasets

**Today:** `run --personas-file pool.json` samples from a JSON pool — either a
bare array of persona rows or `{ "personas": [...], "version": "..." }`. Rows use
the `RawPersona` fields (`uuid`, `age`, `sex`, `occupation`, `marital_status`,
`professional_persona`, `persona`, plus optional `country`, `region`,
`locality`, `sex_norm`, `education_level`); rows without `country` belong to
the pool regardless of `--country`. `RawPersona` also allows optional
`ethnicity` / `religion` for custom pools; the DuckDB pool table has no such
columns and v1 prompts don't consume them.

**Planned (§13):** a TOML dataset definition mapping arbitrary CSV / `hf://`
columns onto those fields. Not implemented; the eight presets are TypeScript
objects in `personas/presets.ts`.

```toml
[dataset]
name   = "my-customers"
source = "file:///path/to/customers.csv"   # or hf://datasets/...

[columns]
uuid       = "customer_id"
age        = "age"
sex        = "gender"
occupation = "job_title"
region     = "prefecture"
persona    = "profile_text"    # becomes the persona system-prompt body

[persona]
lang = "ja"                    # reaction language for this pool
```

## 8. Run store and output contract

Runs live under the XDG data dir and double as the resume checkpoint and the
public output format:

```
<data>/wind-tunnel/
  personas.duckdb              # persona pools (written by `personas pull`)
  runs/<run-id>/
    input.json                 # message, country, situation, languages, filters, models, batch
    status.json                # live stage marker, timestamps, warnings, error
    personas.json              # the sampled personas
    opinions.jsonl             # one reaction per line, appended as generated
    scores.json                # per-opinion sentiment scores
    analyze.json               # verdict: index, triggers, safe version
    cluster.json               # propositions, clusters, consensus, division, minority
    suggest.json               # alternatives + common ground
    result.csv                 # flat export for spreadsheets / pandas / R
```

A stage artifact containing `null` means the stage completed without a usable
result (non-fatal degradation: cluster/suggest); an absent file means the stage
has not run yet — resume walks exactly that distinction. JSON artifacts are
written atomically (tmp + rename) so a crash can't leave a truncated file that
looks like a completed stage.

`input`, `status`, `personas` and `scores` carry `schemaVersion`; `analyze`,
`cluster` and `suggest` hold the bare result object (or `null`). This layout is the API: downstream
consumers (`pandas.read_json(..., lines=True)`, R, jq) read files, not a library.
`resume` replays completed stages from these files and continues from the first
missing one. Interrupting a 15-minute react stage costs nothing — opinions
already generated are on disk.

Paths follow XDG (`XDG_CONFIG_HOME`, `XDG_DATA_HOME`), defaulting to `~/.config`
and `~/.local/share` on all platforms.

## 9. Configuration

`<config>/wind-tunnel/config.toml`, overridden by `WT_*` environment variables,
overridden by flags:

```toml
profile = "local"              # local | hybrid

[model]
# gemini_api_key = "..."       # gemini: roles (or GEMINI_API_KEY / WT_GEMINI_API_KEY)
bulk     = "ollama:qwen3:8b"
analysis = "ollama:qwen3:14b"
premium  = "ollama:qwen3:14b"

[run]
country     = "usa"
personas    = 100
batch       = 5                # requests in flight for batched stages (1-64)
situation   = "sns_viral"
output_lang = "en"             # defaults to the pool country's language (jp -> ja, others -> en)

[ollama]
host = "http://localhost:11434"

[lmstudio]
host = "http://localhost:1234"
```

Reaction language is derived from the pool (country preset or dataset TOML) and is
not a per-run setting. `output_lang` controls only the analysis text (verdict,
cluster names, suggestions).

## 10. CLI surface

| Command | Purpose |
| --- | --- |
| `wt-cli run "<message>"` | full pipeline; flags: `--country --personas --batch --profile --model-* --context` |
| `wt-cli resume <run-id>` | continue an interrupted run from its checkpoint |
| `wt-cli personas pull <code>` | ingest a preset pool from Hugging Face |
| `wt-cli personas list` | show installed pools (count, version, ingest date) |
| `wt-cli doctor` | reachability and models present for the providers in use (Ollama: what is loaded, plus a parallelism note; LM Studio: loaded context) |
| `wt-cli init` | interactive first-run: write config.toml |

`run` renders live progress (stage, opinions done/total, elapsed) and finishes
with a terminal summary: backlash index and voice split, top triggers, one card
per opinion group, the minority view, rewrite suggestions, and the run directory path.

## 11. Port map

What moves from the original codebase, and what changes on the way:

| Original | Destination | Notes |
| --- | --- | --- |
| `lib/prompts.ts` | `core/src/prompts/` | Keep persona system prompts, situation framing, channel cultures, length policies, manual-context block. Drop: chat/rehearsal framings, research-brief prompt, Malaysia ethnicity clause |
| `lib/schemas.ts` | `core/src/schemas.ts` | Keep country/situation/lang/risk enums. The lenient LLM output schemas were dropped: constrained decoding made them unreachable, and each stage now owns a strict generation schema (§5). Countries: the 8 presets. `PersonaLang`: ja/en/fr/ko/pt/vi. Output lang: ja/en. Drop: session/org/project/profile/group CRUD schemas |
| `lib/types.ts` | `core/src/types.ts` | Keep Opinion, FlameResult, cluster result types, run results contract. Drop: SaaS API row types, SSE event type, legacy recommendation shape |
| `lib/clustering.ts` | `core/src/analysis/clustering.ts` | As-is (pure math) |
| `lib/scoring.ts` | `core/src/analysis/scoring.ts` | Classification/buckets/percentages as-is; CSS color mapping stays out of core (CLI maps sentiment to ANSI) |
| `lib/opinion-cluster-stages.ts` | `core/src/pipeline/cluster-stages.ts` | LLM stages; JSON parsing hardened via `format` |
| `lib/llm-json.ts`, `lib/sanitize.ts` | `core/src/util/` | llm-json dropped (fence-stripping JSON parse; unreachable once every call is constrained). sanitize reworked: the keyword filter rewrote ordinary ad copy (`IMPORTANT:`, `assistant:`), so user text is now embedded verbatim inside `<post>` / `<reference>` blocks declared as material, not instructions |
| `lib/export.ts` | `core/src/util/csv.ts` | CSV only (provenance markdown dropped) |
| `api/debate/route.ts` | `core/src/pipeline/react.ts` | SSE route becomes an async generator + shared batch executor |
| `api/analyze/route.ts` | `core/src/pipeline/analyze.ts` | Split per §4 (scores batched / verdict sampled) |
| `api/opinion-cluster/route.ts` | `core/src/pipeline/cluster.ts` | Numeric orchestration, minus HTTP |
| `api/recommend/route.ts` | `core/src/pipeline/suggest.ts` | Prompt assembly extracted from the route |
| `api/filter-personas/route.ts` | `core/src/personas/pool.ts` | Postgres query becomes DuckDB |
| `lib/run-flame-pipeline.ts` | `core/src/run/execute.ts` (+ `run/store.ts`) | Internal `fetch` + DB patches become direct calls + run-dir writes |
| `lib/models.ts` | `core/src/models/` | Drop Vercel WIF/OIDC and `server-only`; add native Ollama provider with per-stage options |
| `scripts/data/ingest_personas_db.py` | `core/src/personas/ingest.ts` | SQL logic ported to DuckDB-over-hf://; Python leaves the project |
| `tests/unit/*` | `packages/core/tests/` | sanitize, prompt language, situation framing, scoring, language resolution |

Not ported at all: auth, billing/quota, org/project tenancy, run history DB,
i18n message catalogs, custom-persona/group CRUD, web UI, embedding scatter,
grounded-research toggles.

## 12. Non-goals (v1)

- No embedding scatter plot (vote-matrix PCA carries the map)
- No web search / grounding
- No multi-turn chat with personas
- No Singapore / El Salvador / Malaysia pools
- No daemon management (diagnose and instruct only)
- No translation of persona reactions; reactions come in the pool's language

## 13. Open questions

- npm scope `@wind-tunnel` availability (only needed for the open-core split)
- Default model choices need a local eval pass (Japanese quality at 8B/14B)
- Windows support level (paths and Ollama detection are written portably, but untested)
- Custom dataset TOML definitions (§7) — the JSON `--personas-file` path works
  today; the TOML mapping layer is not built yet

## 14. Milestones

| Phase | Deliverable |
| --- | --- |
| A | Workspace scaffold, tooling, this document |
| B | Core pure modules ported with their unit tests |
| C | Model layer: native Ollama provider, Gemini, `doctor` |
| D | Pipeline: react generator, batched analyze, cluster, suggest, run store + resume |
| E | CLI shell: commands, config, progress rendering |
| F | Persona ingest: DuckDB `hf://` -> local DuckDB pool, eight presets (custom TOML still planned) |
| G | Docker image, CI, npm publish readiness |
