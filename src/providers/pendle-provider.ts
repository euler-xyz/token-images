import type { ImageProvider, ImageResult } from "./interface";
import { delay, RATE_LIMIT_CONFIG } from "../utils";

// Pendle API interfaces based on the response structure
interface PendleAsset {
    name: string;
    decimals: number;
    address: string;
    symbol: string;
    tags: string[];
    expiry?: string;
    proIcon?: string;
}

interface PendleResponse {
    assets: PendleAsset[];
}

/**
 * PendleProvider - fetches token metadata from Pendle API
 * Uses Pendle's assets API to get token images
 */
export class PendleProvider implements ImageProvider {
    name = "pendle";
    private baseUrl = "https://api-v2.pendle.finance/core/v3";
    private cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
    private cache = new Map<number, { data: PendleAsset[]; timestamp: number }>();

    // Supported chain IDs by Pendle
    private supportedChains = [
        1,      // Ethereum Mainnet
        42161,  // Arbitrum One
        // Add more chains as Pendle supports them
    ];

    constructor() {
        // No API key required for Pendle
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        // Check if chain is supported
        if (!this.supportedChains.includes(chainId)) {
            return null;
        }

        try {
            const assets = await this.fetchPendleAssets(chainId);
            if (!assets) {
                return null;
            }

            // Find asset by address (case insensitive)
            const asset = assets.find(
                a => a.address.toLowerCase() === address.toLowerCase()
            );

            if (!asset?.proIcon) {
                return null;
            }

            // Determine extension from URL
            const extension = this.getExtensionFromUrl(asset.proIcon);

            console.log(`Found token image via Pendle for ${chainId}/${address}: ${asset.proIcon}`);

            return {
                url: asset.proIcon,
                provider: this.name,
                extension,
            };
        } catch (error) {
            console.error(`Pendle provider error for ${chainId}/${address}:`, error);
            return null;
        }
    }

    private async fetchPendleAssets(chainId: number): Promise<PendleAsset[] | null> {
        try {
            // Check cache first
            const cached = this.cache.get(chainId);
            const now = Date.now();

            if (cached && (now - cached.timestamp) < this.cacheExpiry) {
                return cached.data;
            }

            console.log(`Fetching Pendle assets for chain ${chainId}`);
            const url = `${this.baseUrl}/${chainId}/assets/all`;

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                console.error(`Pendle API error: ${response.status} ${response.statusText}`);
                return null;
            }

            const data: PendleResponse = await response.json();

            if (!data.assets || !Array.isArray(data.assets)) {
                console.error(`Invalid Pendle response format for chain ${chainId}`);
                return null;
            }

            // Cache the result
            this.cache.set(chainId, {
                data: data.assets,
                timestamp: now
            });

            console.log(`Fetched ${data.assets.length} Pendle assets for chain ${chainId}`);
            return data.assets;
        } catch (error) {
            console.error(`Error fetching Pendle assets for chain ${chainId}:`, error);
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
                    return 'svg'; // Pendle mostly uses SVG icons
            }
        } catch {
            return 'svg';
        }
    }

    // Utility method to check if a chain is supported
    isChainSupported(chainId: number): boolean {
        return this.supportedChains.includes(chainId);
    }

    // Utility method to get supported chains
    getSupportedChains(): number[] {
        return [...this.supportedChains];
    }

    // Method to search by symbol (bonus feature)
    async findImageBySymbol(symbol: string, chainId?: number): Promise<ImageResult | null> {
        try {
            const chainsToCheck = chainId ? [chainId] : this.supportedChains;

            for (let i = 0; i < chainsToCheck.length; i++) {
                const currentChainId = chainsToCheck[i];
                const assets = await this.fetchPendleAssets(currentChainId);

                if (!assets) {

                    continue;
                }

                // Find asset by symbol (case insensitive)
                const asset = assets.find(
                    a => a.symbol.toLowerCase() === symbol.toLowerCase()
                );

                if (asset?.proIcon) {
                    const extension = this.getExtensionFromUrl(asset.proIcon);

                    console.log(`Found token image by symbol via Pendle for ${symbol} on chain ${currentChainId}: ${asset.proIcon}`);

                    return {
                        url: asset.proIcon,
                        provider: this.name,
                        extension,
                    };
                }


            }

            return null;
        } catch (error) {
            console.error(`Pendle provider symbol search error for ${symbol}:`, error);
            return null;
        }
    }

    // Clear cache (useful for testing or forced refresh)
    clearCache(): void {
        this.cache.clear();
    }

    // Get cache statistics
    getCacheStats(): { totalChains: number; cachedChains: number; oldestCache: number | null } {
        const now = Date.now();
        const cachedEntries = Array.from(this.cache.values());

        return {
            totalChains: this.supportedChains.length,
            cachedChains: cachedEntries.length,
            oldestCache: cachedEntries.length > 0
                ? Math.min(...cachedEntries.map(c => now - c.timestamp))
                : null
        };
    }

    // Utility method to check if provider is available
    isAvailable(): boolean {
        return true;
    }
}
