# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS doppler

ARG TARGETARCH
RUN set -eux; \
  apt-get update; \
  apt-get install --no-install-recommends -y ca-certificates curl; \
  rm -rf /var/lib/apt/lists/*; \
  case "$TARGETARCH" in \
    amd64) \
      DOPPLER_URL='https://github.com/DopplerHQ/cli/releases/download/3.76.0/doppler_3.76.0_linux_amd64.tar.gz'; \
      DOPPLER_SHA256='04f1ff30ed162d7af1dba7f11ad6a37ef35099de86a7ec6e261b64b1b337a3f3'; \
      ;; \
    arm64) \
      DOPPLER_URL='https://github.com/DopplerHQ/cli/releases/download/3.76.0/doppler_3.76.0_linux_arm64.tar.gz'; \
      DOPPLER_SHA256='ee57701385fc33fba550f913641812ed2ff020631e3ac8cc14616cbde2118884'; \
      ;; \
    *) \
      echo "Unsupported TARGETARCH: $TARGETARCH" >&2; \
      exit 1; \
      ;; \
  esac; \
  curl --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 \
    --output /tmp/doppler.tar.gz "$DOPPLER_URL"; \
  printf '%s  %s\n' "$DOPPLER_SHA256" /tmp/doppler.tar.gz | sha256sum --check --strict -; \
  tar --extract --gzip --file /tmp/doppler.tar.gz --directory /usr/local/bin doppler; \
  chmod 0755 /usr/local/bin/doppler

FROM oven/bun:1-slim AS deps

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --production

# ── Runtime stage ──
FROM oven/bun:1-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=doppler /usr/local/bin/doppler /usr/local/bin/doppler
COPY --from=deps /app/node_modules ./node_modules

COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Both directories are read from process.cwd() at runtime and must be in the
# image: images/ backs LocalImagesProvider, the /labels routes and the default
# fallback image; .data/ backs the Pendle PT lookup tables.
COPY images ./images
COPY .data ./.data

EXPOSE 4000

# No HEALTHCHECK on purpose - the ALB target group probes /health.
USER bun

# Doppler injects all app secrets (COINGECKO_API_KEY, SIM_DUNE_API_KEY,
# EULER_AWS_*, EULER_API_URL, ...) at runtime.
CMD ["doppler", "run", "--", "bun", "run", "src/server.ts"]
