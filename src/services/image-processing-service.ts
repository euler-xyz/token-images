import sharp from "sharp";

const PENDLE_RING_COLOR = "#17e3c2";

/**
 * Apply a teal ring effect to an image for Pendle PT tokens.
 * The ring is proportional to the image size (size / 15, minimum 1px).
 *
 * @param imageBuffer - The original image buffer
 * @param extension - The image file extension
 * @returns The processed image buffer with the ring applied
 */
export async function applyPendlePTRing(
    imageBuffer: Uint8Array,
    extension: string
): Promise<{ buffer: Uint8Array; extension: string }> {
    try {
        // Get image metadata
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();

        if (!metadata.width || !metadata.height) {
            console.warn("Could not get image dimensions, returning original");
            return { buffer: imageBuffer, extension };
        }

        // Use the smaller dimension for circular processing
        const size = Math.min(metadata.width, metadata.height);
        const ringSize = Math.max(1, Math.round(size / 15));

        // The inner image size (leaving room for the ring)
        const innerSize = size - ringSize * 2;

        if (innerSize <= 0) {
            console.warn("Image too small for ring effect, returning original");
            return { buffer: imageBuffer, extension };
        }

        // Create a circular mask for the inner image
        const circleMask = Buffer.from(
            `<svg width="${innerSize}" height="${innerSize}">
                <circle cx="${innerSize / 2}" cy="${innerSize / 2}" r="${innerSize / 2}" fill="white"/>
            </svg>`
        );

        // Resize and apply circular mask to the original image
        const innerImage = await sharp(imageBuffer)
            .resize(innerSize, innerSize, { fit: "cover" })
            .composite([
                {
                    input: circleMask,
                    blend: "dest-in",
                },
            ])
            .png()
            .toBuffer();

        // Create the ring as a background circle
        const ringBackground = Buffer.from(
            `<svg width="${size}" height="${size}">
                <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${PENDLE_RING_COLOR}"/>
            </svg>`
        );

        // Composite: ring background + inner circular image centered
        const result = await sharp(ringBackground)
            .composite([
                {
                    input: innerImage,
                    top: ringSize,
                    left: ringSize,
                },
            ])
            .png()
            .toBuffer();

        return {
            buffer: new Uint8Array(result),
            extension: "png", // Always output PNG to preserve transparency
        };
    } catch (error) {
        console.error("Error applying Pendle PT ring:", error);
        // Return original on error
        return { buffer: imageBuffer, extension };
    }
}
