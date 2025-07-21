import { Hono } from "hono";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const app = new Hono();

// Function to get MIME type based on file extension
function getMimeType(extension: string): string {
	const mimeTypes: Record<string, string> = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
		".svg": "image/svg+xml",
	};

	return mimeTypes[extension.toLowerCase()] || "application/octet-stream";
}

// Function to find image file regardless of extension
async function findImageFile(
	chainId: string,
	address: string,
): Promise<{ path: string; extension: string } | null> {
	const tokenDir = join(process.cwd(), chainId, address.toLowerCase());

	if (!existsSync(tokenDir)) {
		return null;
	}

	try {
		const files = await readdir(tokenDir);
		const imageFile = files.find((file) => file.startsWith("image."));

		if (!imageFile) {
			return null;
		}

		const extension = `.${imageFile.split(".").pop()}`;
		return {
			path: join(tokenDir, imageFile),
			extension,
		};
	} catch (error) {
		console.error(`Error reading directory ${tokenDir}:`, error);
		return null;
	}
}

// Route to serve token images
app.get("/:chainId/:address", async (c) => {
	const chainId = c.req.param("chainId");
	const address = c.req.param("address");

	if (!chainId || !address) {
		return c.json({ error: "Missing chainId or address" }, 400);
	}

	try {
		const imageInfo = await findImageFile(chainId, address);

		if (!imageInfo) {
			return c.json({ error: "Image not found" }, 404);
		}

		const imageBuffer = await readFile(imageInfo.path);
		const mimeType = getMimeType(imageInfo.extension);

		return new Response(imageBuffer, {
			headers: {
				"Content-Type": mimeType,
				"Cache-Control": "public, max-age=86400", // Cache for 1 day
			},
		});
	} catch (error) {
		console.error(`Error serving image for ${chainId}/${address}:`, error);
		return c.json({ error: "Internal server error" }, 500);
	}
});

// Health check endpoint
app.get("/health", (c) => {
	return c.json({ status: "ok" });
});

// 404 handler
app.notFound((c) => {
	return c.json({ error: "Not found" }, 404);
});

const port = process.env.PORT || 4000;

console.log(`Server running on port ${port}`);

export default {
	port,
	fetch: app.fetch,
};
