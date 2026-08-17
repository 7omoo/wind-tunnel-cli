# Wind Tunnel CLI image. Intended pairings:
#   - Linux + NVIDIA: docker compose up (bundled ollama service, GPU passthrough)
#   - CI / cloud runs: this image with a remote OLLAMA_HOST or a gemini profile
#
# Apple Silicon note: containers cannot reach the GPU (Metal), so local Mac use
# should run both Ollama AND the CLI natively (npm). If you must run this image
# on a Mac, point it at the host daemon: OLLAMA_HOST=http://host.docker.internal:11434

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /src
# Dependency manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# Assemble the runtime app: built bundle + production dependencies only
# (the workspace core package is compiled into the bundle).
RUN mkdir /out \
  && cp -r packages/cli/dist /out/dist \
  && node -e "const p=require('./packages/cli/package.json'); delete p.devDependencies; delete p.scripts; require('fs').writeFileSync('/out/package.json', JSON.stringify(p, null, 2))" \
  && cd /out && npm install --omit=dev --no-audit --no-fund

FROM node:22-slim
WORKDIR /app
COPY --from=build /out /app
# Persona pools, run artifacts, and config land under these mounts.
ENV XDG_DATA_HOME=/data \
    XDG_CONFIG_HOME=/config \
    NODE_ENV=production
VOLUME ["/data", "/config"]
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["--help"]
