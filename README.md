# Euler Token Images

Automated token image fetching from CoinGecko API for all Euler Finance tokens across supported chains.

## Features

- Automatically fetches all tokens from Euler Finance API
- Downloads token images from CoinGecko Pro API
- Organizes images in `chain/address/image.png` structure
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

# Set API key
export COINGECKO_API_KEY=your_api_key_here

# Run the script (automatically fetches all tokens)
bun run src/fetch-images.ts
```

### GitHub Actions

The workflow runs daily at midnight UTC or can be triggered manually.

## Output Structure

```
chain/
└── contractAddress/
    └── image.png
```

Example: `ethereum/0x50bd66d59911f5e086ec87ae43c811e0d059dd11/image.png`

## API Sources

- **Token Data**: Euler Finance API (`https://index-dev.euler.finance/v1/tokens`)
- **Images**: CoinGecko Pro API (`https://pro-api.coingecko.com/api/v3/coins`)