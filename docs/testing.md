# Testing strategy

Status: Implemented
Last updated: 2026-10-06

Five layers, from pure functions to the shipped binary. Each layer answers a
question the layers below it cannot, and every layer runs green on a machine
with nothing installed — suites that need external state skip themselves
instead of failing.

| Layer | Where | Question it answers |
| --- | --- | --- |
| 1. Pure units | `packages/*/tests/*.test.ts` (majority) | Is the logic right? Scoring math, consensus/division/bridging against hand-computed values, stratified sampling, clustering collapse rule, Ollama/LM Studio probe parsing against a local HTTP server, CJK-aware layout, config precedence, error classification, prompt framing, CSV/JSON edge cases |
| 2. Pipeline over mock models | `run-execute.test.ts`, `cluster.test.ts`, `analyze.test.ts`, `react.test.ts` | Do the stages compose? One mock "brain" answers every LLM call by recognizing the prompt's shape, so the full filter → react → score → verdict → cluster → suggest flow runs in milliseconds — including resume semantics, fail-closed behavior, and atomic artifact writes |
| 3. Commands in process | `packages/cli/tests/commands.test.ts` | Do the CLI commands behave, error paths included? `run`, `resume`, `detail`, `doctor`, `personas list` and the preflight are called as functions against the same Ollama stub, with XDG isolated and `WT_*` cleared — the branches layer 4 cannot reach cheaply, and visible to coverage |
| 4. Black-box E2E | `packages/cli/tests/e2e-cli.test.ts` | Does the *shipped artifact* work? The built `dist/index.js` is spawned as a subprocess and talks to an in-process HTTP stub of the Ollama API — no project imports, only argv, env, and the wire |
| 5. Live integration | `*-integration.test.ts`, `ingest-hf.test.ts` | Do our assumptions about the real world hold? Real daemon, real `qwen3:0.6b`, real Hugging Face parquet |

## Why it is shaped this way

**The mock brain routes by prompt shape.** Stages are not mocked
individually; a single function inspects each prompt ("Score every
reaction", "Return votes as one row per opinion", …) and answers in that
stage's schema. If a stage's prompt or schema changes, the mock stops
matching and the test fails — the routing doubles as a contract check on the
prompts themselves.

**The E2E stub asserts what went over the wire.** The native Ollama provider
exists for two guarantees the OpenAI-compat endpoint silently dropped:
per-stage `num_ctx` actually reaching the daemon, and JSON schemas shipped as
Ollama's `format` for constrained decoding. The stub records every request so
the E2E asserts both on the real HTTP traffic of the real binary. It is also
why the E2E needs no daemon and runs on every CI matrix job.

**Live tests self-skip rather than gate.** `describe.skipIf(!daemonUp)`
keeps `pnpm test` green anywhere while still running the real checks on
machines that have Ollama (`brew services start ollama && ollama pull
qwen3:0.6b`). The 0.6B integration run is a structural check, not a quality
one: a tiny model writes poor reactions, but every stage must still produce
schema-valid artifacts. The network-heavy Hugging Face ingest is opt-in via
`WT_TEST_HF=1`.

## Deliberately not automated

- **TTY animation** (spinner timing, in-place erase sequences): the layout
  math behind the renderer is unit-tested (`format.test.ts`); the animation
  itself is verified by running the CLI.
- **Signal handling under a real terminal** (Ctrl-C mid-run, SIGPIPE from
  `| head`): exercised manually — kill a live run, pipe into `head` — because
  automating PTY signal delivery is flakier than the code it would test. The
  logic behind it (error classification, resume hints) is unit-tested in
  `errors.test.ts`.
- **Windows**: written portably (XDG paths, no shell-outs), untested.

## Running

```bash
pnpm test                # layers 1-3 always; 4 needs a prior pnpm build; 5 self-skips
pnpm build && pnpm test  # includes the black-box E2E
pnpm test:coverage       # same + V8 coverage (text summary + coverage/index.html)
WT_TEST_HF=1 pnpm exec vitest run packages/core/tests/ingest-hf.test.ts   # live ingest
```

CI (`.github/workflows/ci.yml`) runs Biome → typecheck → build → the full
suite with coverage → a smoke of the built binary, on Node 20 and 22.

Reading the coverage number (~81% lines / ~71% branches without a daemon):
the engine (`core/src/pipeline`, `run`, `analysis`, `util`) sits at 90-100%,
and layer 3 makes the CLI commands visible. What stays low is deliberate:
`cli/src/index.ts` is argv wiring exercised by layer 4 in a subprocess (which
V8 coverage cannot see), `init` is an interactive prompt, and the Hugging Face
ingest (`personas pull`) is covered by layer 5 only, so its lines count only
where that opt-in suite ran.
