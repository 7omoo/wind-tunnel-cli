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

## Development

Requires Node >= 20 and pnpm.

```
pnpm install
pnpm test
pnpm build
```

## License

TBD — will be settled before the first release.
