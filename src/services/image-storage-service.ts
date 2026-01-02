import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

// Check if S3 credentials are available
const hasS3Credentials = !!(
    process.env.EULER_AWS_ACCESS_KEY &&
    process.env.EULER_AWS_SECRET_ACCESS_KEY
);

// Storage mode: "s3" or "local"
export const STORAGE_MODE = hasS3Credentials ? "s3" : "local";

// Local storage directory for debugging (separate from images/ which contains source images)
const LOCAL_STORAGE_DIR = join(process.cwd(), "local-storage");

// S3 client configuration - only initialize if credentials are available
const s3Client = hasS3Credentials
    ? new S3Client({
        region: process.env.AWS_REGION || "eu-west-1",
        forcePathStyle: false,
        credentials: {
            accessKeyId: process.env.EULER_AWS_ACCESS_KEY || "",
            secretAccessKey: process.env.EULER_AWS_SECRET_ACCESS_KEY || "",
        },
    })
    : null;

const BUCKET_NAME = "euler-token-images";

// Log storage mode on initialization
console.log(`Storage mode: ${STORAGE_MODE}${STORAGE_MODE === "local" ? " (S3 credentials not provided)" : ""}`);

// Function to get MIME type based on file extension
export function getMimeType(extension: string): string {
    const cleanExtension = extension.startsWith('.') ? extension.slice(1) : extension;

    const mimeTypes: Record<string, string> = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "svg": "image/svg+xml",
        "gif": "image/gif",
        "bmp": "image/bmp",
        "ico": "image/x-icon",
        "tiff": "image/tiff",
        "tif": "image/tiff",
    };

    return mimeTypes[cleanExtension.toLowerCase()] || "application/octet-stream";
}

// Helper to get local storage path for a token image
function getLocalStoragePath(chainId: number, address: string): string {
    return join(LOCAL_STORAGE_DIR, chainId.toString(), address.toLowerCase());
}

// Helper to get local image file path (with extension from metadata)
function getLocalImageFilePath(chainId: number, address: string, extension?: string): string {
    const basePath = getLocalStoragePath(chainId, address);
    return join(basePath, `image${extension ? `.${extension}` : ""}`);
}

// Helper to get local metadata file path
function getLocalMetadataPath(chainId: number, address: string): string {
    return join(getLocalStoragePath(chainId, address), "metadata.json");
}

// ============= S3 Storage Functions =============

async function getImageFromS3(
    chainId: number,
    address: string,
): Promise<{ buffer: Uint8Array; contentType: string; extension?: string } | null> {
    if (!s3Client) return null;

    try {
        const key = `${chainId}/${address.toLowerCase()}/image`;
        const getCommand = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        const response = await s3Client.send(getCommand);

        if (!response.Body) {
            return null;
        }

        // Convert stream to buffer
        const chunks: Uint8Array[] = [];
        const reader = response.Body.transformToWebStream().getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        const buffer = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
        }

        let contentType = response.ContentType || "application/octet-stream";
        let extension: string | undefined = undefined;

        if (response.Metadata?.extension) {
            extension = response.Metadata.extension;
            contentType = getMimeType(response.Metadata.extension);
        }

        return {
            buffer,
            contentType,
            extension,
        };
    } catch (error) {
        console.error(`Error fetching image from S3 for ${chainId}/${address}:`);
        return null;
    }
}

async function checkImageExistsInS3(
    chainId: number,
    address: string,
): Promise<boolean> {
    if (!s3Client) return false;

    try {
        const key = `${chainId}/${address.toLowerCase()}/image`;
        const headCommand = new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        await s3Client.send(headCommand);
        return true;
    } catch (error) {
        return false;
    }
}

async function uploadImageToS3(
    chainId: number,
    address: string,
    imageBuffer: Uint8Array,
    extension: string,
    metadata: {
        provider: string;
        downloadDate: string;
        originalUrl?: string;
    }
): Promise<boolean> {
    if (!s3Client) return false;

    try {
        const key = `${chainId}/${address.toLowerCase()}/image`;
        const contentType = getMimeType(extension);

        const putCommand = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: imageBuffer,
            ContentType: contentType,
            Metadata: {
                extension: extension,
                provider: metadata.provider,
                downloadDate: metadata.downloadDate,
                ...(metadata.originalUrl && { originalUrl: metadata.originalUrl }),
            },
        });

        await s3Client.send(putCommand);
        console.log(`Successfully uploaded image to S3: ${key}`);
        return true;
    } catch (error) {
        console.error(`Error uploading to S3 for ${chainId}/${address}:`, error);
        return false;
    }
}

// ============= Local Storage Functions =============

async function getImageFromLocalStorage(
    chainId: number,
    address: string,
): Promise<{ buffer: Uint8Array; contentType: string; extension?: string } | null> {
    try {
        const tokenDir = getLocalStoragePath(chainId, address);
        const metadataPath = getLocalMetadataPath(chainId, address);

        // Try to read metadata to get extension
        let extension: string | undefined;
        try {
            const metadataContent = await readFile(metadataPath, "utf-8");
            const metadata = JSON.parse(metadataContent);
            extension = metadata.extension;
        } catch {
            // Metadata file doesn't exist, try to find image file
        }

        // Find the image file
        let imagePath: string | undefined;
        try {
            const files = await readdir(tokenDir);
            const imageFile = files.find((f) => f.startsWith("image."));
            if (imageFile) {
                imagePath = join(tokenDir, imageFile);
                if (!extension) {
                    extension = imageFile.split(".").pop();
                }
            }
        } catch {
            return null;
        }

        if (!imagePath) {
            return null;
        }

        const buffer = await readFile(imagePath);
        const contentType = extension ? getMimeType(extension) : "application/octet-stream";

        return {
            buffer: new Uint8Array(buffer),
            contentType,
            extension,
        };
    } catch (error) {
        return null;
    }
}

async function checkImageExistsInLocalStorage(
    chainId: number,
    address: string,
): Promise<boolean> {
    try {
        const tokenDir = getLocalStoragePath(chainId, address);
        const files = await readdir(tokenDir);
        return files.some((f) => f.startsWith("image."));
    } catch {
        return false;
    }
}

async function uploadImageToLocalStorage(
    chainId: number,
    address: string,
    imageBuffer: Uint8Array,
    extension: string,
    metadata: {
        provider: string;
        downloadDate: string;
        originalUrl?: string;
    }
): Promise<boolean> {
    try {
        const tokenDir = getLocalStoragePath(chainId, address);

        // Create directory structure
        await mkdir(tokenDir, { recursive: true });

        // Write image file
        const imagePath = getLocalImageFilePath(chainId, address, extension);
        await writeFile(imagePath, imageBuffer);

        // Write metadata file
        const metadataPath = getLocalMetadataPath(chainId, address);
        await writeFile(metadataPath, JSON.stringify({
            extension,
            ...metadata,
        }, null, 2));

        console.log(`Successfully saved image to local storage: ${imagePath}`);
        return true;
    } catch (error) {
        console.error(`Error saving to local storage for ${chainId}/${address}:`, error);
        return false;
    }
}

// ============= Unified Storage Interface =============

/**
 * Get image from storage (S3 or local depending on configuration)
 */
export async function getImageFromStorage(
    chainId: number,
    address: string,
): Promise<{ buffer: Uint8Array; contentType: string; extension?: string } | null> {
    if (STORAGE_MODE === "s3") {
        return getImageFromS3(chainId, address);
    }
    return getImageFromLocalStorage(chainId, address);
}

/**
 * Check if image exists in storage (S3 or local depending on configuration)
 */
export async function checkImageExistsInStorage(
    chainId: number,
    address: string,
): Promise<boolean> {
    if (STORAGE_MODE === "s3") {
        return checkImageExistsInS3(chainId, address);
    }
    return checkImageExistsInLocalStorage(chainId, address);
}

/**
 * Upload image to storage (S3 or local depending on configuration)
 */
export async function uploadImageToStorage(
    chainId: number,
    address: string,
    imageBuffer: Uint8Array,
    extension: string,
    metadata: {
        provider: string;
        downloadDate: string;
        originalUrl?: string;
    }
): Promise<boolean> {
    if (STORAGE_MODE === "s3") {
        return uploadImageToS3(chainId, address, imageBuffer, extension, metadata);
    }
    return uploadImageToLocalStorage(chainId, address, imageBuffer, extension, metadata);
}

/**
 * Bulk check which images exist in storage
 */
export async function bulkCheckImagesInStorage(
    tokens: Array<{ chainId: number; address: string }>
): Promise<Array<{ chainId: number; address: string; exists: boolean }>> {
    const results = await Promise.allSettled(
        tokens.map(async (token) => ({
            chainId: token.chainId,
            address: token.address,
            exists: await checkImageExistsInStorage(token.chainId, token.address),
        }))
    );

    return results.map((result, index) => ({
        chainId: tokens[index].chainId,
        address: tokens[index].address,
        exists: result.status === 'fulfilled' ? result.value.exists : false,
    }));
}

// Re-export for backward compatibility (will be removed in future)
export { getImageFromS3, checkImageExistsInS3, uploadImageToS3 };
