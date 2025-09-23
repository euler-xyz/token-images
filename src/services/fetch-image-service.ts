// Types for image providers

import { CoinGeckoProvider } from "../providers/coingecko-provider";
import { LocalImagesProvider } from "../providers/local-images-provider";
import { AlchemyProvider } from "../providers/alchemy-provider";
import { SimDuneProvider } from "../providers/sim-dune-provider";
import { PendleProvider } from "../providers/pendle-provider";
import { TokenListProvider } from "../providers/token-list-provider";
import type { ImageProvider, ImageResult } from "../providers/interface";
import { delay, RATE_LIMIT_CONFIG } from "../utils";

// Image provider manager
export class ImageProviderManager {
    private providers: ImageProvider[] = [];

    constructor() {
        // Add default providers in order: Local -> CoinGecko -> Alchemy -> Sim Dune -> Pendle -> Token Lists
        this.addProvider(new LocalImagesProvider());
        this.addProvider(new CoinGeckoProvider());

        // Only add Alchemy provider if API key is available
        const alchemyProvider = new AlchemyProvider();
        if (alchemyProvider.isAvailable()) {
            this.addProvider(alchemyProvider);
            console.log("Alchemy provider initialized successfully");
        } else {
            console.log("Alchemy provider disabled - no API key found");
        }

        // Only add Sim Dune provider if API key is available
        const simDuneProvider = new SimDuneProvider();
        if (simDuneProvider.isAvailable()) {
            this.addProvider(simDuneProvider);
            console.log("Sim Dune provider initialized successfully");
        } else {
            console.log("Sim Dune provider disabled - no API key found");
        }

        // Add Pendle provider (no API key required)
        this.addProvider(new PendleProvider());
        console.log("Pendle provider initialized successfully");

        this.addProvider(new TokenListProvider()); // Added as last provider
    }

    addProvider(provider: ImageProvider): void {
        this.providers.push(provider);
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[i];
            try {
                const result = await provider.fetchImage(chainId, address);
                if (result) {
                    return result;
                }

            } catch (error) {
                console.error(`Provider ${provider.name} failed for ${chainId}/${address}:`, error);
                continue;
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
}
