# Euler Token Images

Token image service for Euler Finance. Fetches token logos from multiple providers, stores them in AWS S3 (or local storage for debugging), and serves them via HTTP.

## Table of Contents

- [Project Structure](#project-structure)
- [Setup](#setup)
- [Scripts](#scripts)
- [HTTP Server & API Endpoints](#http-server--api-endpoints)
- [Sync Flow](#sync-flow)
- [Image Providers](#image-providers)
- [Storage Architecture](#storage-architecture)
- [Adding Custom Token Logos](#adding-custom-token-logos)
- [Pendle PT Tokens](#pendle-pt-tokens)
- [CI/CD](#cicd)

## Project Structure

```
euler-token-images/
├── src/
│   ├── server.ts                       # Hono HTTP server
│   ├── utils.ts                        # Shared utilities & rate-limit config
│   ├── providers/                      # Image provider implementations
│   │   ├── interface.ts                # ImageProvider / ImageResult types
│   │   ├── local-images-provider.ts    # Local filesystem (images/ folder)
│   │   ├── coingecko-provider.ts       # CoinGecko Pro API
│   │   ├── oneinch-provider.ts         # 1inch token list
│   │   ├── alchemy-provider.ts         # Alchemy API
│   │   ├── sim-dune-provider.ts        # Sim Dune API
│   │   ├── pendle-provider.ts          # Pendle API
│   │   └── token-list-provider.ts      # Aggregates 25+ public token lists
│   └── services/
│       ├── sync-service.ts             # Orchestrates the sync process
│       ├── fetch-image-service.ts      # ImageProviderManager (priority chain)
│       ├── image-storage-service.ts    # Unified S3 / local storage abstraction
│       ├── image-processing-service.ts # Sharp-based image manipulation (PT ring)
│       └── pendle-pt-service.ts        # Pendle PT token detection & exceptions
├── scripts/
│   ├── migration.ts                    # Bulk migration: .data/ token lists → images/
│   └── force-update-token.ts           # Force-update a single token image in storage
├── images/                             # Local source images (committed to repo)
│   ├── default.png                     # Fallback image when no logo is found
│   └── {chainId}/{address}/image.{ext} # Per-token images
├── .data/                              # Token list JSON files per chain
│   ├── ethereumTokenList.json
│   ├── baseTokenList.json
│   └── ...
├── local-storage/                      # Local storage mirror (gitignored, debug only)
├── .github/workflows/
│   └── fetch-token-images.yml          # Daily CI workflow
├── .env.example                        # Environment variable template
├── package.json
└── tsconfig.json
```

## Setup

### Prerequisites

- [Bun](https://bun.sh/) runtime

### Installation

```bash
bun install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
# Required
COINGECKO_API_KEY=           # CoinGecko Pro API key
EULER_API_URL=               # Euler Finance API (default: https://index-dev.euler.finance)

# S3 storage (optional - falls back to local-storage/ if not set)
AWS_REGION=                  # AWS region (default: eu-west-1)
EULER_AWS_ACCESS_KEY=        # AWS access key for S3
EULER_AWS_SECRET_ACCESS_KEY= # AWS secret key for S3

# Optional
PORT=                        # Server port (default: 4000)
SIM_DUNE_API_KEY=            # Sim Dune API key
RPC_HTTP_1=                  # Ethereum RPC endpoint
```

When S3 credentials are not provided, all storage operations fall back to the `local-storage/` directory. This is useful for local development.

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| **start** | `bun run start` | Start the HTTP server (default port 4000) |
| **migration** | `bun run migration` | Bulk migration: reads `.data/*.json` token lists, downloads images from S3/providers, writes them to `images/` |
| **force-update** | `bun run force-update -- --chainId <id> --address <addr>` | Force-update a single token's image in storage (S3 or local) |

### force-update

Overwrites the stored image for a specific token. Useful when a token's logo has changed or needs manual correction.

```bash
# Update USDC on Ethereum mainnet
bun run force-update -- --chainId 1 --address 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

How it works:
1. Checks `images/{chainId}/{address}/` for a local image file
2. If not found locally, queries all image providers
3. Uploads (overwrites) the image in storage

## HTTP Server & API Endpoints

```bash
bun run start            # port 4000
PORT=3000 bun run start  # custom port
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{chainId}/{address}` | Serve token image (falls back to `default.png`) |
| `GET` | `/sync/{chainId}` | Trigger sync for a chain (or return running status) |
| `GET` | `/sync/{chainId}/status` | Get sync status without triggering |
| `GET` | `/health` | Health check |

### Image Serving

```
GET /1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48   → USDC on Ethereum
GET /8453/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913  → USDC on Base
```

- Returns the image from storage (S3 or local) with appropriate `Content-Type`
- Falls back to `images/default.png` if not found
- Cached with `Cache-Control: public, max-age=86400` (24 hours)
- Pendle PT tokens with local overrides automatically get a teal ring applied

### Sync

```
GET /sync/1      → sync all Ethereum mainnet tokens
GET /sync/8453   → sync all Base tokens
```

Rate limited to 1 sync per chain per minute. Returns `429` if rate limited.

## Sync Flow

The sync process follows four steps:

```
1. Fetch Token List     → Euler API returns all tokens for the chain
2. Check Storage        → Bulk-check S3/local for existing images (skip those)
3. Migrate Local Images → Upload images from images/ folder to S3
4. Download Missing     → Query providers, download, and upload to storage
```

### Sync Response

```json
{
  "success": true,
  "data": {
    "chainId": 1,
    "totalTokens": 150,
    "existingImages": 120,
    "migratedFromLocal": 15,
    "downloadedImages": 10,
    "failedDownloads": 5,
    "duration": 45000,
    "details": [
      { "address": "0x...", "status": "exists|migrated|downloaded|failed", "provider": "coingecko" }
    ]
  }
}
```

## Image Providers

All providers implement the `ImageProvider` interface and are queried **in parallel**. The first successful result by priority order wins.

| Priority | Provider | Source | Notes |
|----------|----------|--------|-------|
| 1 | Local | `images/` folder | Committed to repo |
| 2 | CoinGecko | CoinGecko Pro API | Requires `COINGECKO_API_KEY` |
| 3 | 1inch | 1inch token list | Skips chains 239, 80094, 60808, 1923 |
| 4 | Alchemy | Alchemy API | Skips chains 80094, 43114 |
| 5 | Sim Dune | Sim Dune API | Requires `SIM_DUNE_API_KEY` |
| 6 | Pendle | Pendle API | Supports chains 1, 42161 |
| 7 | Token Lists | 25+ public token lists | Uniswap, Aave, etc. |

## Storage Architecture

### S3 Bucket

Bucket: `euler-token-images`

```
euler-token-images/
├── 1/
│   └── 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/
│       └── image          ← no file extension; extension stored in metadata
├── 8453/
│   └── ...
└── {chainId}/{address}/image
```

Each S3 object includes metadata:

```json
{
  "ContentType": "image/png",
  "Metadata": {
    "extension": "png",
    "provider": "coingecko",
    "downloadDate": "2025-01-21T10:30:00.000Z",
    "originalUrl": "https://assets.coingecko.com/..."
  }
}
```

### Local Storage Fallback

When S3 credentials are not configured, the same structure is mirrored under `local-storage/` with an additional `metadata.json` file per token.

## Adding Custom Token Logos

To add or replace a token logo manually:

1. Place the image at `images/{chainId}/{address}/image.{ext}` (address must be lowercase)
2. Run `bun run force-update -- --chainId <chainId> --address <address>` to push it to S3

Or simply commit the image to the repo - it will be picked up on the next sync as the local provider has the highest priority.

## Pendle PT Tokens

Pendle PT tokens automatically receive a teal ring (`#17e3c2`) when served. This applies when:

1. The token has `isPendlePT: true` in its `.data/*.json` token list entry, **OR**
2. The token address is in the `PENDLE_PT_EXCEPTIONS` set in `src/services/pendle-pt-service.ts`

**AND** the token has a local image override in the `images/` folder.

To add a new PT exception:

```typescript
// src/services/pendle-pt-service.ts
const PENDLE_PT_EXCEPTIONS = new Set([
    "0xb6168f597cd37a232cb7cb94cd1786be20ead156",
    // Add new PT addresses here (lowercase)
]);
```

## Supported Chains

| Chain | ID |
|-------|----|
| Ethereum | 1 |
| Arbitrum | 42161 |
| Base | 8453 |
| Avalanche | 43114 |
| BSC | 56 |
| Sonic | 146, 1923 |
| Berachain | 80094 |
| Bob | 60808 |
| Unichain | 130 |
| Linea | 59144 |
| Mantle | 5000 |
| Swell | 1868 |
| TAC | 2741 |
| Ink | 57073 |
| HyperEVM | 2911 |
| Monad | 10143 |

## CI/CD

### Sync Token Images (`.github/workflows/fetch-token-images.yml`)

Keeps token images up to date by triggering the sync endpoint on the production service.

**Schedule:** Daily at midnight UTC (also supports manual `workflow_dispatch`).

**How it works:**

1. Loops through all 17 supported chain IDs
2. Sends `GET https://token-images.euler.finance/sync/{chainId}` for each chain
3. Waits 2 minutes between requests to respect the rate limit
4. Logs the result per chain:
   - `200` — sync triggered successfully
   - `429` — rate limited or already syncing (non-fatal, skipped)
   - Any other status — logged as a failure and emits a GitHub Actions warning

No checkout, build, or credentials are needed — the workflow only makes HTTP requests to the deployed service, which handles fetching from providers and uploading to S3 internally.
