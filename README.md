# Wind Tunnel

Simulate how hundreds of AI personas react to your message — locally, before you publish it.

Give it a draft (an ad, a post, an announcement). Wind Tunnel runs the text past a
demographically grounded pool of personas, collects their reactions, and maps the result:
backlash risk, what triggers whom, where opinion clusters form, and which rewrites defuse
the heat. A wind tunnel doesn't predict flight — it shows you the forces before you fly.

**Status: pre-alpha.** The engine is being ported; nothing is usable yet.
See [docs/DESIGN.md](docs/DESIGN.md) for the architecture and roadmap.

## Planned shape

```
windtunnel personas pull jp        # fetch a persona pool (Hugging Face -> local SQLite)
windtunnel run "draft copy..."     # filter -> react -> analyze -> cluster -> suggest
windtunnel resume <run-id>         # continue an interrupted run
windtunnel doctor                  # check Ollama, models, effective parallelism
```

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
