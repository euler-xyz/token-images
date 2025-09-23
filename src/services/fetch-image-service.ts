// Types for image providers

import { CoinGeckoProvider } from "../providers/coingecko-provider";
import { LocalImagesProvider } from "../providers/local-images-provider";
import type { ImageProvider, ImageResult } from "../providers/interface";

// Image provider manager
export class ImageProviderManager {
    private providers: ImageProvider[] = [];

    constructor() {
        // Add default providers - Local provider first for faster local lookups
        this.addProvider(new LocalImagesProvider());
        this.addProvider(new CoinGeckoProvider());
    }

    addProvider(provider: ImageProvider): void {
        this.providers.push(provider);
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        for (const provider of this.providers) {
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
}
