import type { ImageProvider, ImageResult } from "./interface";

// CoinGecko provider implementation
export class CoinGeckoProvider implements ImageProvider {
    name = "coingecko";
    private apiKey: string;
    private baseUrl = "https://pro-api.coingecko.com/api/v3/coins";

    private chainIdToCoingeckoId: Record<number, string> = {
        1: "ethereum",
        56: "binance-smart-chain",
        146: "sonic",
        8453: "base",
        42161: "arbitrum-one",
        43114: "avalanche",
        1923: "sonic",
        60808: "bob",
        80094: "berachain",
        130: "unichain",
    };

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.COINGECKO_API_KEY || "";
        if (!this.apiKey) {
            console.warn("CoinGecko API key not provided - provider will be disabled");
        }
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        if (!this.apiKey) {
            return null;
        }

        const coingeckoChainId = this.chainIdToCoingeckoId[chainId];
        if (!coingeckoChainId) {
            return null;
        }

        try {
            const url = `${this.baseUrl}/${coingeckoChainId}/contract/${address.toLowerCase()}`;
            const response = await fetch(url, {
                headers: {
                    "x-cg-pro-api-key": this.apiKey,
                },
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            const imageUrl = data.image?.large;

            if (!imageUrl) {
                return null;
            }

            // Determine extension from URL
            const extension = this.getExtensionFromUrl(imageUrl);

            return {
                url: imageUrl,
                provider: this.name,
                extension,
            };
        } catch (error) {
            console.error(`CoinGecko provider error for ${chainId}/${address}:`, error);
            return null;
        }
    }

    private getExtensionFromUrl(url: string): string {
        try {
            const pathname = new URL(url).pathname;
            const extension = pathname.split('.').pop()?.toLowerCase();

            // Map common extensions
            switch (extension) {
                case 'png':
                case 'jpg':
                case 'jpeg':
                case 'webp':
                case 'svg':
                    return extension;
                default:
                    return 'png'; // Default fallback
            }
        } catch {
            return 'png';
        }
    }

    // Utility method to check if provider is available
    isAvailable(): boolean {
        return !!this.apiKey;
    }
}
