# Docker

Status: Implemented
Last updated: 2026-08-17

For Linux hosts with an NVIDIA GPU, `compose.yaml` bundles an Ollama service
with GPU passthrough:

```
docker compose up -d ollama
docker compose run --rm ollama-pull                      # fetch role models
docker compose run --rm windtunnel personas pull usa
docker compose run --rm windtunnel run "draft copy..."
```

Model weights live in the `ollama-models` volume; persona pools and run
artifacts in `windtunnel-data`.

**Apple Silicon:** containers cannot reach the GPU (Metal), so local Mac use
should run both Ollama and the CLI natively — the npm package is the primary
distribution for a reason. The image alone also suits CI/cloud runs pointed at
a remote `OLLAMA_HOST`, or a `hybrid`/cloud model profile.

Building the image locally:

```
docker build -t wind-tunnel-cli .
docker run --rm wind-tunnel-cli doctor
```
