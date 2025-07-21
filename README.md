# Euler Token Images

Automated token image fetching and serving for Euler Finance tokens across supported chains.

## Features

- Automatically fetches all tokens from Euler Finance API
- Downloads token images from CoinGecko Pro API
- Processes static token lists with remote logoURI images
- Organizes images in `chain/address/image.png` structure
- HTTP server to serve token images via REST API
- Case-insensitive address lookup
- Automated daily GitHub Actions workflow
- Automatic PR creation and management
- Closes existing PRs before creating new ones

## Supported Chains

- **Ethereum** (1)
- **Base** (8453)
- **Sonic** (1923, 146)
- **Bob** (60808)
- **zkSync** (80094)
- **Avalanche** (43114)
- **BSC** (56)
- **Polygon** (130)

## Setup

1. Add `COINGECKO_API_KEY` secret to your GitHub repository
2. The script automatically fetches tokens from `https://index-dev.euler.finance/v1/tokens?chainId=X`

## Usage

### Manual Script Execution

```bash
# Install dependencies
bun install

# Set API key (for CoinGecko API)
export COINGECKO_API_KEY=your_api_key_here

# Fetch images from Euler Finance API
bun run fetch-images

# Fetch images from static token lists
bun run fetch-static-images
```

### HTTP Server

Start the image serving server:

```bash
# Start server (default port 4000)
bun run start

# Or specify custom port
PORT=3000 bun run start
```

#### API Endpoints

- `GET /{chainId}/{address}` - Serve token image (case-insensitive address)
- `GET /health` - Health check endpoint

Examples:
- `GET /1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` → serves USDC image
- `GET /8453/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` → serves Base USDC image

### GitHub Actions

The workflow runs daily at midnight UTC or can be triggered manually.

## Output Structure

```
chain/
└── contractAddress/
    └── image.png
```

Example: `ethereum/0x50bd66d59911f5e086ec87ae43c811e0d059dd11/image.png`

## Scripts

- `fetch-images` - Fetch token images from Euler Finance API + CoinGecko
- `fetch-static-images` - Process static token lists and download remote images
- `start` - Start the HTTP server to serve token images

## API Sources

- **Token Data**: Euler Finance API (`https://index-dev.euler.finance/v1/tokens`)
- **Static Lists**: Local JSON files in `src/staticList/`
- **Images**: CoinGecko Pro API (`https://pro-api.coingecko.com/api/v3/coins`) and remote URLs