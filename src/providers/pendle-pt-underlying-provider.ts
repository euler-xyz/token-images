import { createPublicClient, http, type Address, parseAbi, type Chain, defineChain } from "viem";
import { mainnet, arbitrum, base, avalanche, bsc } from "viem/chains";

// Define Unichain (not in viem by default)
const unichain = defineChain({
    id: 130,
    name: "Unichain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
        default: { http: ["https://mainnet.unichain.org"] },
    },
});
import type { ImageProvider, ImageResult } from "./interface";
import { getImageFromS3 } from "../services/image-s3-service";

// ABI for Pendle PT contract - only the SY function
const ptAbi = parseAbi([
    "function SY() external view returns (address)"
]);

// ABI for Pendle SY contract - only the assetInfo function
const syAbi = parseAbi([
    "function assetInfo() external view returns (uint8 assetType, address assetAddress, uint8 assetDecimals)"
]);

// Token metadata from tokenlist
interface TokenMeta {
    isPendlePT?: boolean;
    pendleMarket?: string;
    [key: string]: unknown;
}

interface TokenListEntry {
    addressInfo: string;
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string;
    meta: TokenMeta;
}

// Chain configurations - RPC URLs are loaded from environment variables
const chainConfigs: Record<number, Chain> = {
    1: mainnet,
    42161: arbitrum,
    8453: base,
    43114: avalanche,
    56: bsc,
    130: unichain,
};

// Get RPC URL for a chain from environment variables
function getRpcUrl(chainId: number): string | null {
    const rpcUrl = process.env[`RPC_HTTP_${chainId}`];
    return rpcUrl || null;
}

// Chain ID to tokenlist filename mapping
const chainIdToTokenListFile: Record<number, string> = {
    1: "ethereumTokenList.json",
    42161: "arbitrumTokenList.json",
    8453: "baseTokenList.json",
    43114: "avalancheTokenList.json",
    56: "bscTokenList.json",
    130: "unichainTokenList.json",
    146: "sonicTokenList.json",
    9745: "plasmaTokenList.json",
    80094: "berachainTokenList.json",
};

/**
 * PendlePTUnderlyingProvider - fetches token images for Pendle PT tokens
 * by looking up the underlying asset address from the contract.
 *
 * This provider:
 * 1. Checks if the token is a Pendle PT (isPendlePT: true in tokenlist)
 * 2. Calls the PT contract's SY() function to get the SY address
 * 3. Calls the SY contract's assetInfo() function to get the underlying asset address
 * 4. Delegates to fetchUnderlyingImage callback to get the underlying token's image
 */
export class PendlePTUnderlyingProvider implements ImageProvider {
    name = "pendle-pt-underlying";

    private tokenlistCache = new Map<number, TokenListEntry[]>();
    private tokenlistCacheExpiry = 5 * 60 * 1000; // 5 minutes
    private tokenlistCacheTimestamps = new Map<number, number>();

    // Callback to fetch image for the underlying token
    private fetchUnderlyingImage: ((chainId: number, address: string) => Promise<ImageResult | null>) | null = null;

    constructor() {
        // Provider is available as long as the callback is set
        // RPC availability is checked per-chain when making contract calls
    }

    /**
     * Set the callback function to fetch images for underlying tokens.
     * This should be called after the provider is added to ImageProviderManager.
     */
    setFetchUnderlyingImage(callback: (chainId: number, address: string) => Promise<ImageResult | null>): void {
        this.fetchUnderlyingImage = callback;
    }

    isAvailable(): boolean {
        return !!this.fetchUnderlyingImage;
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        if (!this.isAvailable()) {
            return null;
        }

        try {
            // Step 1: Check if token is a Pendle PT
            const isPT = await this.isPendlePT(chainId, address);
            if (!isPT) {
                return null;
            }

            console.log(`[PendlePT] Detected PT token ${address} on chain ${chainId}, fetching underlying asset...`);

            // Step 2: Get the underlying asset address
            const underlyingAddress = await this.getUnderlyingAssetAddress(chainId, address);
            if (!underlyingAddress) {
                console.log(`[PendlePT] Failed to resolve underlying asset for PT ${address}`);
                return null;
            }

            console.log(`[PendlePT] PT ${address} -> underlying ${underlyingAddress}`);

            // Step 3: Check if we already have a logo for the underlying asset in S3
            console.log(`[PendlePT] Checking S3 for existing logo of underlying ${underlyingAddress}...`);
            const existingImage = await getImageFromS3(chainId, underlyingAddress);
            if (existingImage) {
                console.log(`[PendlePT] Found existing logo in S3 for underlying ${underlyingAddress}`);
                return {
                    buffer: existingImage.buffer,
                    provider: this.name,
                    extension: existingImage.extension || "png",
                };
            }

            // Step 4: Fetch image for the underlying token from external providers
            console.log(`[PendlePT] No S3 logo found, fetching from external providers for underlying ${underlyingAddress}...`);
            if (!this.fetchUnderlyingImage) {
                return null;
            }

            const result = await this.fetchUnderlyingImage(chainId, underlyingAddress);
            if (result) {
                console.log(`[PendlePT] Successfully fetched logo for underlying ${underlyingAddress} via ${result.provider}`);
                return {
                    ...result,
                    provider: this.name,
                };
            }

            console.log(`[PendlePT] No logo found for underlying ${underlyingAddress}`);
            return null;
        } catch (error) {
            console.error(`[PendlePT] Error processing PT ${address} on chain ${chainId}:`, error);
            return null;
        }
    }

    /**
     * Check if a token is a Pendle PT by looking it up in the tokenlist
     */
    private async isPendlePT(chainId: number, address: string): Promise<boolean> {
        // TODO: TEMPORARY DEBUG OVERRIDE - REMOVE AFTER TESTING
        if (address.toLowerCase() === "0xB6168F597Cd37A232cb7CB94CD1786Be20eAD156".toLowerCase()) {
            console.log(`[PendlePT] DEBUG: Forcing ${address} to be treated as PT (temporary override)`);
            return true;
        }

        const tokenlist = await this.loadTokenList(chainId);
        if (!tokenlist) {
            return false;
        }

        const token = tokenlist.find(
            t => t.addressInfo.toLowerCase() === address.toLowerCase()
        );

        return token?.meta?.isPendlePT === true;
    }

    /**
     * Load tokenlist for a chain (with caching)
     */
    private async loadTokenList(chainId: number): Promise<TokenListEntry[] | null> {
        const now = Date.now();
        const cached = this.tokenlistCache.get(chainId);
        const cacheTimestamp = this.tokenlistCacheTimestamps.get(chainId);

        if (cached && cacheTimestamp && (now - cacheTimestamp) < this.tokenlistCacheExpiry) {
            return cached;
        }

        const filename = chainIdToTokenListFile[chainId];
        if (!filename) {
            return null;
        }

        try {
            const file = Bun.file(`.data/${filename}`);
            if (!await file.exists()) {
                console.log(`[PendlePT] Tokenlist file not found: .data/${filename}`);
                return null;
            }

            const content = await file.text();
            const tokenlist: TokenListEntry[] = JSON.parse(content);

            // Count PT tokens for logging
            const ptCount = tokenlist.filter(t => t.meta?.isPendlePT === true).length;
            console.log(`[PendlePT] Loaded tokenlist for chain ${chainId}: ${tokenlist.length} total tokens, ${ptCount} Pendle PT tokens`);

            this.tokenlistCache.set(chainId, tokenlist);
            this.tokenlistCacheTimestamps.set(chainId, now);

            return tokenlist;
        } catch (error) {
            console.error(`[PendlePT] Error loading tokenlist for chain ${chainId}:`, error);
            return null;
        }
    }

    /**
     * Get the underlying asset address for a Pendle PT token
     * by calling the contract's SY() and assetInfo() functions
     */
    private async getUnderlyingAssetAddress(chainId: number, ptAddress: string): Promise<string | null> {
        const chain = chainConfigs[chainId];
        if (!chain) {
            console.log(`[PendlePT] Chain ${chainId} not supported for contract calls`);
            return null;
        }

        const rpcUrl = getRpcUrl(chainId);
        if (!rpcUrl) {
            console.log(`[PendlePT] No RPC URL configured for chain ${chainId} (set RPC_HTTP_${chainId})`);
            return null;
        }

        try {
            const client = createPublicClient({
                chain,
                transport: http(rpcUrl),
            });

            // Step 1: Call SY() on the PT contract to get the SY address
            const syAddress = await client.readContract({
                address: ptAddress as Address,
                abi: ptAbi,
                functionName: "SY",
            });

            if (!syAddress) {
                console.log(`[PendlePT] SY() returned null for ${ptAddress}`);
                return null;
            }

            console.log(`[PendlePT] SY contract: ${syAddress}`);

            // Step 2: Call assetInfo() on the SY contract to get the underlying asset
            const [assetType, assetAddress, assetDecimals] = await client.readContract({
                address: syAddress as Address,
                abi: syAbi,
                functionName: "assetInfo",
            });

            if (!assetAddress) {
                console.log(`[PendlePT] assetInfo() returned null assetAddress`);
                return null;
            }

            console.log(`[PendlePT] assetInfo: type=${assetType}, address=${assetAddress}, decimals=${assetDecimals}`);

            return assetAddress;
        } catch (error) {
            console.error(`[PendlePT] Contract call error for ${ptAddress}:`, error);
            return null;
        }
    }

    /**
     * Clear the tokenlist cache
     */
    clearCache(): void {
        this.tokenlistCache.clear();
        this.tokenlistCacheTimestamps.clear();
    }
}
