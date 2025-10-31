import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { ImageProviderManager } from "../src/services/fetch-image-service";
import { checkImageExistsInS3, getImageFromS3 } from "../src/services/image-s3-service";

type DataToken = {
    addressInfo?: string;
    address?: string;
    chainId: number;
    logoURI?: string;
};

function toLowerAddress(addr: string): string {
    return addr.toLowerCase();
}

function contentTypeToExtension(contentType: string): string {
    const map: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/svg+xml": "svg",
        "image/gif": "gif",
        "image/bmp": "bmp",
        "image/x-icon": "ico",
        "image/tiff": "tiff",
    };
    return map[contentType.toLowerCase()] || "png";
}

function urlToExtension(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const ext = pathname.split(".").pop()?.toLowerCase();
        if (!ext) return "png";
        if (["png", "jpg", "jpeg", "webp", "svg", "gif", "bmp", "ico", "tiff"].includes(ext)) {
            return ext === "jpeg" ? "jpg" : ext;
        }
        return "png";
    } catch {
        return "png";
    }
}

function convertToAbsoluteUrl(url: string): string {
    // Handle relative URLs that start with /tokens
    if (url.startsWith('/tokens')) {
        return `https://app.euler.finance${url}`;
    }
    return url;
}

async function ensureDir(path: string): Promise<void> {
    if (!existsSync(path)) {
        await mkdir(path, { recursive: true });
    }
}

async function writeImage(chainId: number, address: string, buffer: Uint8Array, extension: string): Promise<void> {
    const outDir = join(process.cwd(), "images", chainId.toString(), toLowerAddress(address));
    await ensureDir(outDir);
    const outPath = join(outDir, `image.${extension}`);
    await writeFile(outPath, buffer);
}

async function hasLocalImage(chainId: number, address: string): Promise<boolean> {
    const base = join(process.cwd(), "images", chainId.toString(), toLowerAddress(address));
    const candidates = ["png", "jpg", "jpeg", "webp", "svg", "gif", "bmp", "ico", "tiff"].map(e => join(base, `image.${e}`));
    return candidates.some((p) => existsSync(p));
}

async function processToken(token: DataToken, providers: ImageProviderManager): Promise<{ status: "skipped" | "s3" | "fetched" | "failed"; reason?: string }> {
    const address = (token.addressInfo || token.address || "").trim();
    const chainId = token.chainId;
    if (!address || !chainId || chainId <= 0) return { status: "skipped", reason: "invalid token" };

    // Skip if already exists locally
    if (await hasLocalImage(chainId, address)) return { status: "skipped", reason: "local exists" };

    // Try S3
    try {
        const inS3 = await checkImageExistsInS3(chainId, address);
        if (inS3) {
            const s3Image = await getImageFromS3(chainId, address);
            if (s3Image && s3Image.buffer) {
                const ext = s3Image.extension || contentTypeToExtension(s3Image.contentType);
                await writeImage(chainId, address, s3Image.buffer, ext);
                return { status: "s3" };
            }
        }
    } catch (_) {
        // ignore S3 errors and fallback to providers
    }

    // If token has a direct logoURI, try it first (handle both absolute and relative URLs)
    if (token.logoURI) {
        const fullUrl = convertToAbsoluteUrl(token.logoURI);
        try {
            console.log(`Fetching image from ${fullUrl}`);
            const res = await fetch(fullUrl);
            if (res.ok) {
                const arrayBuf = await res.arrayBuffer();
                const ext = urlToExtension(fullUrl);
                await writeImage(chainId, address, new Uint8Array(arrayBuf), ext);
                return { status: "fetched" };
            }
        } catch (_) {
            console.error(`Error fetching image from ${fullUrl}:`, _);
            return { status: "failed", reason: "url fetch failed" };
        }
    }

    return { status: "failed", reason: "url fetch failed" };
    // Providers fallback
    // try {
    //     const result = await providers.fetchImage(chainId, address);
    //     if (!result) return { status: "failed", reason: "providers none" };

    //     let buffer: Uint8Array | null = null;
    //     if (result.buffer) buffer = result.buffer;
    //     else if (result.url) {
    //         const fullUrl = convertToAbsoluteUrl(result.url);
    //         const r = await fetch(fullUrl);
    //         if (!r.ok) return { status: "failed", reason: "url fetch failed" };
    //         buffer = new Uint8Array(await r.arrayBuffer());
    //     }
    //     if (!buffer) return { status: "failed", reason: "no buffer" };

    //     const ext = result.extension || (result.url ? urlToExtension(result.url) : "png");
    //     await writeImage(chainId, address, buffer, ext);
    //     return { status: "fetched" };
    // } catch (e) {
    //     return { status: "failed", reason: (e as Error)?.message || "error" };
    // }
}

async function main() {
    const dataDir = join(process.cwd(), ".data");
    const files = (await readdir(dataDir)).filter((f) => f.endsWith(".json"));
    const providers = new ImageProviderManager();

    const summary = { total: 0, localSkipped: 0, s3: 0, fetched: 0, failed: 0 };

    for (const file of files) {
        const full = join(dataDir, file);
        const raw = await readFile(full, "utf8");
        let list: unknown;
        try {
            list = JSON.parse(raw);
        } catch {
            continue;
        }
        if (!Array.isArray(list)) continue;

        for (const item of list as DataToken[]) {
            summary.total++;
            const result = await processToken(item, providers);
            if (result.status === "skipped") summary.localSkipped++;
            else if (result.status === "s3") summary.s3++;
            else if (result.status === "fetched") summary.fetched++;
            else summary.failed++;
        }
    }

    console.log(
        JSON.stringify(
            {
                processed: summary.total,
                localSkipped: summary.localSkipped,
                fromS3: summary.s3,
                fetched: summary.fetched,
                failed: summary.failed,
            },
            null,
            2
        )
    );
}

// Bun automatically loads .env; still ensure working dir exists
main().catch((e) => {
    console.error(e);
    process.exit(1);
});


