import type { ImageProvider, ImageResult } from "./interface";
import { delay, RATE_LIMIT_CONFIG } from "../utils";

// Token list interfaces based on 1inch token list structure
export interface TokenListToken {
    address: string;
    chainId: number;
    decimals: number;
    symbol: string;
    name: string;
    logoURI?: string;
}

export interface TokenList {
    name: string;
    timestamp: string;
    version: {
        major: number;
        minor: number;
        patch: number;
    };
    keywords: string[];
    logoURI?: string;
    tokens: TokenListToken[];
}

/**
 * TokenListProvider - checks multiple token lists for token images
 * This provider fetches token lists and looks for logoURI fields
 */
export class TokenListProvider implements ImageProvider {
    name = "token-lists";
    private tokenListUrls: string[];
    private cacheExpiry = 1 * 60 * 1000; // 1 minute cache to avoid rate limits
    private cache = new Map<string, { data: TokenList; timestamp: number }>();

    constructor(tokenListUrls?: string[]) {
        this.tokenListUrls = tokenListUrls || [
            "https://tokens.uniswap.org/",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://tokens.1inch.eth.link",
            "https://gateway.ipfs.io/ipns/tokens.uniswap.org",
            "https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json",
            "https://tokens.coingecko.com/uniswap/all.json",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://tokenlist.aave.eth.link",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://datafi.theagora.eth.link",
            "https://raw.githubusercontent.com/The-Blockchain-Association/sec-notice-list/master/ba-sec-list.json",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://defi.cmc.eth.link",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://stablecoin.cmc.eth.link",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://erc20.cmc.eth.link",
            "https://defiprime.com/defiprime.tokenlist.json",
            "https://www.gemini.com/uniswap/manifest.json",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://t2crtokens.eth.link",
            "https://cdn.furucombo.app/furucombo.tokenlist.json",
            "https://uniswap.mycryptoapi.com/",
            "https://static.optimism.io/optimism.tokenlist.json",
            "https://raw.githubusercontent.com/SetProtocol/uniswap-tokenlist/main/set.tokenlist.json",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://list.tkn.eth.link",
            "https://ipfs.io/ipns/tokens.uniswap.org",
            "https://uniswap.mycryptoapi.com/",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://wrapped.tokensoft.eth.link",
            "https://wispy-bird-88a7.uniswap.workers.dev/?url=http://tokenlist.zerion.eth.link",
            "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/tokenlist.json",
            "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/tokenlist.json",
            "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/tokenlist.json",
            "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/tokenlist.json",
            "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/tokenlist.json",
            "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sonic/tokenlist.json",
            "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/zksync/tokenlist.json",
            "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/linea/tokenlist.json",
            // Add more token list URLs here as needed
        ];
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        try {
            // Check all token lists for the token
            for (let i = 0; i < this.tokenListUrls.length; i++) {
                const listUrl = this.tokenListUrls[i];
                const tokenList = await this.fetchTokenList(listUrl);
                if (!tokenList) {

                    continue;
                }

                // Find token in the list
                const token = tokenList.tokens.find(
                    t => {
                        if (t.chainId === chainId &&
                            t.address.toLowerCase() === address.toLowerCase() && t.logoURI) {
                            return true;
                        }
                        if ("extensions" in t && t.extensions) {
                            // ** Special case for uniswap token list **
                            const extensions = t.extensions as { bridgeInfo: Record<string, { tokenAddress: string }> };
                            if (extensions?.bridgeInfo && extensions?.bridgeInfo[chainId.toString()]) {
                                return extensions.bridgeInfo[chainId.toString()]?.tokenAddress?.toLowerCase() === address.toLowerCase() && t.logoURI;
                            }
                        }
                        return false;
                    }
                );

                if (token && token.logoURI) {
                    // Determine extension from URL
                    const extension = this.getExtensionFromUrl(token.logoURI);

                    console.log(`Found token image in ${tokenList.name} for ${chainId}/${address}: ${token.logoURI}`);

                    return {
                        url: token.logoURI,
                        provider: this.name,
                        extension,
                    };
                }
            }

            return null;
        } catch (error) {
            console.error(`TokenListProvider error for ${chainId}/${address}:`, error);
            return null;
        }
    }

    // Method to search by symbol (bonus feature)
    async findImageBySymbol(symbol: string, chainId?: number): Promise<ImageResult | null> {
        try {
            // Check all token lists for the token by symbol
            for (let i = 0; i < this.tokenListUrls.length; i++) {
                const listUrl = this.tokenListUrls[i];
                const tokenList = await this.fetchTokenList(listUrl);
                if (!tokenList) {

                    continue;
                }

                // Find token by symbol (case insensitive)
                const token = tokenList.tokens.find(t => {
                    const symbolMatch = t.symbol.toLowerCase() === symbol.toLowerCase();
                    // If chainId is specified, also match chainId
                    const chainMatch = chainId ? t.chainId === chainId : true;
                    return symbolMatch && chainMatch;
                });

                if (token && token.logoURI) {
                    // Determine extension from URL
                    const extension = this.getExtensionFromUrl(token.logoURI);

                    console.log(`Found token image by symbol in ${tokenList.name} for ${symbol} (${token.chainId}/${token.address}): ${token.logoURI}`);

                    return {
                        url: token.logoURI,
                        provider: this.name,
                        extension,
                    };
                }


            }
            return null;
        } catch (error) {
            console.error(`TokenListProvider symbol search error for ${symbol}:`, error);
            return null;
        }
    }

    private async fetchTokenList(url: string): Promise<TokenList | null> {
        try {
            // Check cache first
            const cached = this.cache.get(url);
            const now = Date.now();

            if (cached && (now - cached.timestamp) < this.cacheExpiry) {
                return cached.data;
            }

            console.log(`Fetching token list from ${url}`);
            const response = await fetch(url);

            if (!response.ok) {
                console.error(`Failed to fetch token list from ${url}: ${response.status}`);
                return null;
            }

            const tokenList: TokenList = await response.json();

            // Validate token list structure
            if (!tokenList.tokens || !Array.isArray(tokenList.tokens)) {
                console.error(`Invalid token list format from ${url}: missing tokens array`);
                return null;
            }

            // Cache the result
            this.cache.set(url, {
                data: tokenList,
                timestamp: now
            });

            console.log(`Fetched ${tokenList.tokens.length} tokens from ${tokenList.name}`);
            return tokenList;
        } catch (error) {
            console.error(`Error fetching token list from ${url}:`, error);
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

    // Utility method to add more token list URLs
    addTokenList(url: string): void {
        if (!this.tokenListUrls.includes(url)) {
            this.tokenListUrls.push(url);
        }
    }

    // Utility method to get all configured token lists
    getTokenListUrls(): string[] {
        return [...this.tokenListUrls];
    }

    // Clear cache (useful for testing or forced refresh)
    clearCache(): void {
        this.cache.clear();
    }

    // Get cache statistics
    getCacheStats(): { totalLists: number; cachedLists: number; oldestCache: number | null } {
        const now = Date.now();
        const cachedLists = Array.from(this.cache.values());

        return {
            totalLists: this.tokenListUrls.length,
            cachedLists: cachedLists.length,
            oldestCache: cachedLists.length > 0
                ? Math.min(...cachedLists.map(c => now - c.timestamp))
                : null
        };
    }

    // Utility method to check if provider is available
    isAvailable(): boolean {
        return true;
    }
}
