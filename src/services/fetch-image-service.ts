// Types for image providers

import { CoinGeckoProvider } from "../providers/coingecko-provider";
import { LocalImagesProvider } from "../providers/local-images-provider";
import { AlchemyProvider } from "../providers/alchemy-provider";
import { SimDuneProvider } from "../providers/sim-dune-provider";
import { PendleProvider } from "../providers/pendle-provider";
import { TokenListProvider } from "../providers/token-list-provider";
import { OneInchProvider } from "../providers/oneinch-provider";
import { PendlePTUnderlyingProvider } from "../providers/pendle-pt-underlying-provider";
import type { ImageProvider, ImageResult } from "../providers/interface";


// Image provider manager
export class ImageProviderManager {
    private providers: ImageProvider[] = [];
    private pendlePTUnderlyingProvider: PendlePTUnderlyingProvider;

    constructor() {
        // Add default providers in order: Local -> CoinGecko -> 1inch -> Alchemy -> Sim Dune -> Pendle -> Token Lists
        this.addProvider(new LocalImagesProvider());
        this.addProvider(new CoinGeckoProvider());
        this.addProvider(new OneInchProvider());
        this.addProvider(new AlchemyProvider());
        this.addProvider(new SimDuneProvider());
        this.addProvider(new PendleProvider());
        // Added as last provider
        this.addProvider(new TokenListProvider());

        // Pendle PT Underlying provider - fetches logo for underlying asset of PT tokens
        // Added last so it only runs when all other providers fail
        this.pendlePTUnderlyingProvider = new PendlePTUnderlyingProvider();
        this.addProvider(this.pendlePTUnderlyingProvider);

        // Set up the callback for fetching underlying token images
        // This uses all providers except the PT underlying provider itself (to avoid infinite loops)
        this.pendlePTUnderlyingProvider.setFetchUnderlyingImage(
            (chainId, address) => this.fetchImageForUnderlying(chainId, address)
        );
    }

    addProvider(provider: ImageProvider): void {
        this.providers.push(provider);
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        // Execute all providers in parallel
        const providerPromises = this.providers.map(async (provider) => {
            try {
                if (!provider.isAvailable()) {
                    return { result: null, provider: provider.name };
                }
                const result = await provider.fetchImage(chainId, address);
                return { result, provider: provider.name };
            } catch (error) {
                console.error(`Provider ${provider.name} failed for ${chainId}/${address}:`, error);
                return { result: null, provider: provider.name };
            }
        });

        // Wait for all providers to complete
        const results = await Promise.all(providerPromises);

        // Return the first successful result (maintaining provider priority order)
        for (const { result } of results) {
            if (result) {
                return result;
            }
        }

        return null;
    }

    getProviderNames(): string[] {
        return this.providers.map(p => p.name);
    }

    getProvider<T extends ImageProvider>(name: string): T | null {
        return (this.providers.find(p => p.name === name) as T) || null;
    }

    getLocalProvider(): LocalImagesProvider | null {
        return this.getProvider<LocalImagesProvider>("local");
    }

    getAlchemyProvider(): AlchemyProvider | null {
        return this.getProvider<AlchemyProvider>("alchemy");
    }

    getSimDuneProvider(): SimDuneProvider | null {
        return this.getProvider<SimDuneProvider>("sim-dune");
    }

    getPendleProvider(): PendleProvider | null {
        return this.getProvider<PendleProvider>("pendle");
    }

    getTokenListProvider(): TokenListProvider | null {
        return this.getProvider<TokenListProvider>("token-lists");
    }

    getOneInchProvider(): OneInchProvider | null {
        return this.getProvider<OneInchProvider>("1inch");
    }

    getPendlePTUnderlyingProvider(): PendlePTUnderlyingProvider | null {
        return this.pendlePTUnderlyingProvider;
    }

    /**
     * Fetch image for underlying tokens (used by PendlePTUnderlyingProvider)
     * This uses all providers except the PT underlying provider itself to avoid infinite loops
     */
    private async fetchImageForUnderlying(chainId: number, address: string): Promise<ImageResult | null> {
        // Filter out the PT underlying provider to avoid infinite loops
        const providersForUnderlying = this.providers.filter(
            p => p.name !== "pendle-pt-underlying"
        );

        // Execute all providers in parallel
        const providerPromises = providersForUnderlying.map(async (provider) => {
            try {
                if (!provider.isAvailable()) {
                    return { result: null, provider: provider.name };
                }
                const result = await provider.fetchImage(chainId, address);
                return { result, provider: provider.name };
            } catch (error) {
                console.error(`Provider ${provider.name} failed for underlying ${chainId}/${address}:`, error);
                return { result: null, provider: provider.name };
            }
        });

        // Wait for all providers to complete
        const results = await Promise.all(providerPromises);

        // Return the first successful result (maintaining provider priority order)
        for (const { result } of results) {
            if (result) {
                return result;
            }
        }

        return null;
    }
}
