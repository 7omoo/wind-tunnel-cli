# Wind Tunnel

Generate and cluster synthetic opinions from hundreds of local AI personas — a CLI for testing messages before you publish.

Give it a draft (an ad, a post, an announcement). Wind Tunnel shows it to a
demographically grounded persona pool, generates their reactions with a local
LLM, and replies with the shape of the crowd — fully local via
[Ollama](https://ollama.com), nothing leaves your machine.

```console
$ wt-cli run "Introducing a 4-day work week. However, salaries will be reduced by 10%."

Backlash index  ████████████████████░░░░  85 / 100  HIGH
Voices          ████████████████████████  critical 83% (5) · neutral 17% · favorable 0%

Triggers
  1. "salaries will be reduced by 10%" (High) → employees in structured,
     mission-critical, or low-margin industries

◆ Pay-First Skeptics (4)  ████████████████
  They believe that reducing pay to shorten the work week is inherently
  disrespectful and fails to address the real issues workers face.
  「I don't like it at all—cutting pay just to work fewer days is plain
  foolish. You can't expect people to do more with less…」
    — 79 · not_in_workforce · Lincoln, AR
...
```

## What you get

- **Backlash index & voice split** — how hot it runs, at a glance
- **Triggers** — which wording offends which segment
- **Opinion groups** — the camps that form, each with its belief and real
  member voices, plus a minority report on what the majority overlooks
  (a unanimous crowd is honestly shown as one camp)
- **Rewrites** — alternatives that keep your intent but defuse the heat
- **`wt-cli detail`** — every voice in full and the proposition × group table
- **Plain artifacts** per run (JSONL / JSON / CSV) for pandas, R, or Excel

## Setup

Requires Node >= 20 and [Ollama](https://ollama.com/download):

```
brew install ollama && brew services start ollama   # macOS (or the desktop app)
ollama pull qwen3:8b && ollama pull qwen3:14b       # role models (one-time, ~15 GB)
```

## Quickstart

```
npx wind-tunnel doctor              # verifies the setup, tells you exactly what's missing
npx wind-tunnel personas pull usa   # streams a persona pool from Hugging Face (~30 s)
npx wind-tunnel run "draft copy..."
```

Installed globally (`npm i -g wind-tunnel`) the command is `wt-cli`. Runs are
resumable (`wt-cli resume <run-id>`) and every option — countries, audience
filters, situations, model overrides — is in the
[command reference](docs/commands.md).

Persona pools cover 8 countries (USA, Japan, India, Brazil, France, Korea,
Vietnam, Belgium), built on NVIDIA's
[Nemotron-Personas](https://huggingface.co/datasets?search=Nemotron-Personas)
datasets (CC BY 4.0); custom pools plug in via `--personas-file`.

## Documentation

| | |
| --- | --- |
| [Commands & configuration](docs/commands.md) | every command and option, config.toml, env vars, run artifacts |
| [Docker](docs/docker.md) | Linux + NVIDIA compose setup, image usage |
| [Design](docs/DESIGN.md) | architecture and the decisions behind it |
| [Testing](docs/testing.md) | the four-layer test strategy, coverage, what deliberately isn't automated |
| [Releasing](docs/RELEASE.md) | maintainer release checklist |

## Development

```
pnpm install && pnpm test && pnpm build
node packages/cli/dist/index.js doctor        # or: cd packages/cli && npm link
```

Ollama-dependent tests skip themselves without a daemon; building first also
enables the black-box E2E of the binary. Strategy: [docs/testing.md](docs/testing.md).

## License

[Apache-2.0](LICENSE). Bundled third-party licenses:
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Persona datasets are
CC BY 4.0 and fetched by users directly from Hugging Face, not redistributed
here.
