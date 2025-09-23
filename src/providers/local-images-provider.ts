import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ImageProvider, ImageResult } from "./interface";

/**
 * LocalImagesProvider - checks for locally stored token images
 * This provider looks for images in the format: images/{chainId}/{address}/image.{ext}
 */
export class LocalImagesProvider implements ImageProvider {
    name = "local";
    private baseImagePath: string;

    constructor(baseImagePath?: string) {
        this.baseImagePath = baseImagePath || join(process.cwd(), "images");
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        const tokenDir = join(this.baseImagePath, chainId.toString(), address.toLowerCase());

        if (!existsSync(tokenDir)) {
            return null;
        }

        try {
            const files = await readdir(tokenDir);
            const imageFile = files.find((file) => file.startsWith("image."));

            if (!imageFile) {
                return null;
            }

            const extension = imageFile.split(".").pop();
            if (!extension) {
                return null;
            }

            const imagePath = join(tokenDir, imageFile);
            const buffer = await readFile(imagePath);

            return {
                buffer: new Uint8Array(buffer),
                provider: this.name,
                extension,
                path: imagePath,
            };
        } catch (error) {
            console.error(`LocalImagesProvider error for ${chainId}/${address}:`, error);
            return null;
        }
    }

    /**
     * Bulk check which tokens have local images
     * This is a utility method specific to this provider
     */
    async bulkCheckLocalImages(
        tokens: Array<{ chainId: number; address: string }>
    ): Promise<Array<{ chainId: number; address: string; hasLocal: boolean }>> {
        const results = await Promise.allSettled(
            tokens.map(async (token) => {
                const localImage = await this.fetchImage(token.chainId, token.address);
                return {
                    chainId: token.chainId,
                    address: token.address,
                    hasLocal: localImage !== null,
                };
            })
        );

        return results.map((result, index) => ({
            chainId: tokens[index].chainId,
            address: tokens[index].address,
            hasLocal: result.status === 'fulfilled' ? result.value.hasLocal : false,
        }));
    }
}
