import type { ImageProvider, ImageResult } from "./interface";

// Alchemy API interfaces
interface AlchemyTokenMetadata {
    name?: string;
    symbol?: string;
    decimals?: number;
    logo?: string;
}

interface AlchemyResponse {
    jsonrpc: string;
    id: number;
    result?: AlchemyTokenMetadata;
    error?: {
        code: number;
        message: string;
    };
}

/**
 * AlchemyProvider - fetches token metadata from Alchemy API
 * Only available if ALCHEMY_API_KEY is set in environment variables
 */
export class AlchemyProvider implements ImageProvider {
    name = "alchemy";
    private apiKey: string;
    private baseUrl = "https://{network}.g.alchemy.com/v2/{apiKey}";
    private ignoreChains = [
        80094,
        43114
    ];
    // Map chainId to Alchemy supported network names
    private chainIdToNetwork: Record<number, string> = {
        1: "eth-mainnet",
        42161: "arb-mainnet",
        141: "sonic-mainnet",
        80094: "berachain-mainnet",
        5000: "mantle-mainnet",
        59144: "linea-mainnet",
        9745: "plasma-mainnet",
        60808: "bob-mainnet",
        999: "hyperliquid-mainnet",
        8453: "base-mainnet",
        43114: "avax-mainnet",
        56: "bnb-mainnet"
    };

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.ALCHEMY_API_KEY || "";
        if (!this.apiKey) {
            console.warn("Alchemy API key not provided - provider will be disabled");
        }
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        if (!this.apiKey) {
            return null;
        }

        if (this.ignoreChains.includes(chainId)) {
            return null;
        }

        const network = this.chainIdToNetwork[chainId];
        if (!network) {
            // Chain not supported by Alchemy
            return null;
        }

        try {
            const url = this.baseUrl
                .replace("{network}", network)
                .replace("{apiKey}", this.apiKey);

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "alchemy_getTokenMetadata",
                    params: [address.toLowerCase()],
                    id: 1,
                }),
            });

            if (!response.ok) {
                console.error(`Alchemy API error: ${response.status} ${response.statusText}`);
                return null;
            }

            const data: AlchemyResponse = await response.json();

            if (data.error) {
                console.error(`Alchemy API error for ${chainId}/${address}:`, data.error);
                return null;
            }

            if (!data.result?.logo) {
                return null;
            }

            // Determine extension from URL
            const extension = this.getExtensionFromUrl(data.result.logo);

            console.log(`Found token image via Alchemy for ${chainId}/${address}: ${data.result.logo}`);

            return {
                url: data.result.logo,
                provider: this.name,
                extension,
            };
        } catch (error) {
            console.error(`Alchemy provider error for ${chainId}/${address}:`, error);
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
                case 'gif':
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

    // Utility method to get supported networks
    getSupportedChains(): number[] {
        return Object.keys(this.chainIdToNetwork).map(Number);
    }

    // Utility method to check if a chain is supported
    isChainSupported(chainId: number): boolean {
        return chainId in this.chainIdToNetwork;
    }

    // Utility method to get network name for a chain
    getNetworkName(chainId: number): string | null {
        return this.chainIdToNetwork[chainId] || null;
    }
}
