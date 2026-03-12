/**
 * Force update a token image in storage.
 *
 * Usage: bun run force-update -- --chainId <chainId> --address <address>
 *
 * 1. Checks the local `images/` folder for an existing image
 * 2. If not found locally, fetches from providers
 * 3. Uploads (overwrites) the image in storage (S3 or local-storage)
 */

import { isAddress } from "viem";
import { ImageProviderManager } from "../src/services/fetch-image-service";
import { uploadImageToStorage } from "../src/services/image-storage-service";

function parseArgs(): { chainId: number; address: string } {
    const args = process.argv.slice(2);
    let chainId: string | undefined;
    let address: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--chainId" && args[i + 1]) {
            chainId = args[++i];
        } else if (args[i] === "--address" && args[i + 1]) {
            address = args[++i];
        }
    }

    if (!chainId || !address) {
        console.error("Usage: bun run force-update -- --chainId <chainId> --address <address>");
        process.exit(1);
    }

    const parsedChainId = parseInt(chainId, 10);
    if (isNaN(parsedChainId)) {
        console.error(`Invalid chainId: ${chainId}`);
        process.exit(1);
    }

    if (!isAddress(address)) {
        console.error(`Invalid address: ${address}`);
        process.exit(1);
    }

    return { chainId: parsedChainId, address: address.toLowerCase() };
}

async function main() {
    const { chainId, address } = parseArgs();
    console.log(`Force updating image for chain ${chainId}, address ${address}`);

    const providerManager = new ImageProviderManager();

    // 1. Check local images/ folder first
    const localProvider = providerManager.getLocalProvider();
    let imageResult = localProvider ? await localProvider.fetchImage(chainId, address) : null;

    if (imageResult) {
        console.log(`Found local image: ${imageResult.path}`);
    } else {
        // 2. Fetch from providers
        console.log("No local image found, fetching from providers...");
        imageResult = await providerManager.fetchImage(chainId, address);

        if (!imageResult) {
            console.error("No image found from any provider.");
            process.exit(1);
        }
        console.log(`Found image from provider: ${imageResult.provider}`);
    }

    // 3. Get the buffer
    let imageBuffer: Uint8Array | null = imageResult.buffer ?? null;

    if (!imageBuffer && imageResult.url) {
        console.log(`Downloading from ${imageResult.url}...`);
        const response = await fetch(imageResult.url);
        if (!response.ok) {
            console.error(`Failed to download image: ${response.status}`);
            process.exit(1);
        }
        imageBuffer = new Uint8Array(await response.arrayBuffer());
    }

    if (!imageBuffer) {
        console.error("Failed to obtain image buffer.");
        process.exit(1);
    }

    // 4. Upload (overwrite) to storage
    console.log(`Uploading image (${imageBuffer.length} bytes, .${imageResult.extension})...`);
    const success = await uploadImageToStorage(
        chainId,
        address,
        imageBuffer,
        imageResult.extension,
        {
            provider: imageResult.provider,
            downloadDate: new Date().toISOString(),
            originalUrl: imageResult.url || imageResult.path || "force-update",
        }
    );

    if (success) {
        console.log("Image updated successfully.");
    } else {
        console.error("Failed to upload image.");
        process.exit(1);
    }
}

main();
