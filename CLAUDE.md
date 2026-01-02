# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Token image service for Euler Finance. Fetches token logos from multiple providers, stores them in AWS S3 (or local storage for debugging), and serves them via HTTP.

## Commands

```bash
# Start the HTTP server (default port 4000)
bun run start

# Run migration script
bun run migration
```

## Architecture

### Core Services

- **SyncService** (`src/services/sync-service.ts`): Orchestrates the sync process - fetches token lists from Euler API, checks S3 for existing images, migrates local images, and downloads missing ones from providers
- **ImageProviderManager** (`src/services/fetch-image-service.ts`): Manages provider chain and parallel fetching
- **image-storage-service.ts**: Unified storage abstraction - uses S3 when credentials provided, falls back to local `local-storage/` directory for debugging

### Provider System

Image providers implement `ImageProvider` interface (`src/providers/interface.ts`):
```typescript
interface ImageProvider {
    name: string;
    fetchImage(chainId: number, address: string): Promise<ImageResult | null>;
    isAvailable(): boolean;
}
```

Providers are tried in this order (see `ImageProviderManager` constructor):
1. Local filesystem
2. CoinGecko
3. 1inch
4. Alchemy
5. Sim Dune
6. Pendle
7. Token Lists

All providers execute in parallel; first successful result (by priority order) wins.

### HTTP Endpoints (Hono)

- `GET /{chainId}/{address}` - Serve token image (from storage with fallback to default.png)
- `GET /sync/{chainId}` - Trigger or get status of sync for a chain
- `GET /sync/{chainId}/status` - Get sync status only (doesn't trigger)
- `GET /health` - Health check

### S3 Structure

Images stored at: `euler-token-images/{chainId}/{address}/image` (no extension in key; extension stored in metadata)

## Environment Variables

Required:
- `COINGECKO_API_KEY` - CoinGecko Pro API key
- `EULER_API_URL` - Euler Finance API (default: https://index-dev.euler.finance)

For S3 storage (optional - falls back to local storage if not set):
- `AWS_REGION` - AWS region (default: eu-west-1)
- `EULER_AWS_ACCESS_KEY` / `EULER_AWS_SECRET_ACCESS_KEY` - S3 credentials

Optional:
- `PORT` - Server port (default: 4000)

## Local Development

When running without S3 credentials, images are stored in `local-storage/` directory (gitignored). This is useful for local debugging.

## Key Implementation Details

- Rate limiting: 1 minute between syncs per chain (enforced in SyncService)
- Request validation uses Zod schemas with viem's `isAddress` for Ethereum addresses
- Sync runs asynchronously; status polling supported via `/sync/{chainId}/status`
- Images cached with 24h Cache-Control header
