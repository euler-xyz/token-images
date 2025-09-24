import type { ImageProvider, ImageResult } from "./interface";

// 1inch token list interfaces
export interface OneInchToken {
    address: string;
    chainId: number;
    decimals: number;
    symbol: string;
    name: string;
    logoURI?: string;
}

export interface OneInchTokenList {
    [address: string]: OneInchToken;
}

/**
 * OneInchProvider - fetches token images from 1inch token list API
 * Uses the 1inch API: https://tokens.1inch.io/v1.2/{chainId}
 */
export class OneInchProvider implements ImageProvider {
    name = "1inch";
    private baseUrl = "https://tokens.1inch.io/v1.2";
    private cacheExpiry = 5 * 60 * 1000; // 5 minute cache to avoid rate limits
    private cache = new Map<number, { data: OneInchTokenList; timestamp: number }>();
    private ignoreChains = [
        239,
        80094,
        60808,
        1923
    ];

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        try {
            if (this.ignoreChains.includes(chainId)) {
                return null;
            }

            const tokenList = await this.fetchTokenList(chainId);
            if (!tokenList) {
                return null;
            }

            // Look for the token by address (case insensitive)
            const normalizedAddress = address.toLowerCase();

            // First try exact match
            let token = tokenList[normalizedAddress];

            // If not found, try searching through all tokens for case-insensitive match
            if (!token) {
                for (const [addr, tokenData] of Object.entries(tokenList)) {
                    if (addr.toLowerCase() === normalizedAddress) {
                        token = tokenData;
                        break;
                    }
                }
            }

            if (!token || !token.logoURI) {
                return null;
            }

            // Determine extension from URL
            const extension = this.getExtensionFromUrl(token.logoURI);

            console.log(`Found token image from 1inch for ${chainId}/${address}: ${token.logoURI}`);

            return {
                url: token.logoURI,
                provider: this.name,
                extension,
            };
        } catch (error) {
            console.error(`1inch provider error for ${chainId}/${address}:`, error);
            return null;
        }
    }

    private async fetchTokenList(chainId: number): Promise<OneInchTokenList | null> {
        try {
            // Check cache first
            const cached = this.cache.get(chainId);
            const now = Date.now();

            if (cached && (now - cached.timestamp) < this.cacheExpiry) {
                return cached.data;
            }

            const url = `${this.baseUrl}/${chainId}`;
            console.log(`Fetching 1inch token list for chain ${chainId} from ${url}`);

            const response = await fetch(url);

            if (!response.ok) {
                console.error(`Failed to fetch 1inch token list for chain ${chainId}: ${response.status}`);
                return null;
            }

            const tokenList: OneInchTokenList = await response.json();

            // Validate response structure
            if (!tokenList || typeof tokenList !== 'object') {
                console.error(`Invalid 1inch token list format for chain ${chainId}: not an object`);
                return null;
            }

            // Cache the result
            this.cache.set(chainId, {
                data: tokenList,
                timestamp: now
            });

            const tokenCount = Object.keys(tokenList).length;
            console.log(`Fetched ${tokenCount} tokens from 1inch for chain ${chainId}`);
            return tokenList;
        } catch (error) {
            console.error(`Error fetching 1inch token list for chain ${chainId}:`, error);
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

    // Clear cache (useful for testing or forced refresh)
    clearCache(): void {
        this.cache.clear();
    }

    // Get cache statistics
    getCacheStats(): { totalChains: number; cachedChains: number; oldestCache: number | null } {
        const now = Date.now();
        const cachedChains = Array.from(this.cache.values());

        return {
            totalChains: this.cache.size,
            cachedChains: cachedChains.length,
            oldestCache: cachedChains.length > 0
                ? Math.min(...cachedChains.map(c => now - c.timestamp))
                : null
        };
    }

    // Utility method to check if provider is available
    isAvailable(): boolean {
        return true;
    }
}
