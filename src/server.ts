import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isAddress } from "viem";
import { getImageFromStorage, getMimeType } from "./services/image-storage-service";
import { SyncService, type RateLimitError } from "./services/sync-service";

const app = new Hono();

// Validation schema
const paramsSchema = z.object({
	chainId: z.string().transform((val) => {
		const num = Number(val);
		if (isNaN(num) || !Number.isInteger(num) || num < 0) {
			throw new Error("chainId must be a valid positive integer value: " + val || "undefined");
		}
		return num;
	}),
	address: z.string().refine((val) => isAddress(val), {
		message: "address must be a valid Ethereum address",
	}),
});

// Validation schema for sync endpoint
const syncParamsSchema = z.object({
	chainId: z.string().transform((val) => {
		const num = Number(val);
		if (isNaN(num) || !Number.isInteger(num) || num < 0) {
			throw new Error("chainId must be a valid positive integer value: " + val || "undefined");
		}
		return num;
	}),
});

// Validation schema for symbol search endpoint
const symbolSearchSchema = z.object({
	symbol: z.string().min(1, "symbol is required"),
	chainId: z.string().optional().transform((val) => {
		if (!val) return undefined;
		const num = Number(val);
		if (isNaN(num) || !Number.isInteger(num) || num < 0) {
			throw new Error("chainId must be a valid positive integer value: " + val);
		}
		return num;
	}),
});

// Sync service instance
const syncService = new SyncService();

// Type guard function
function isRateLimitError(result: any): result is RateLimitError {
	return result && result.rateLimited === true;
}


// Sync endpoint - RPC style: triggers sync or returns current status
app.get("/sync/:chainId", async (c) => {
	try {
		// Validate chainId parameter
		const { chainId } = syncParamsSchema.parse({
			chainId: c.req.param("chainId"),
		});

		// Check if sync is already running for this chainId
		const existingStatus = syncService.getSyncStatus(chainId);

		if (existingStatus && existingStatus.status === 'running') {
			console.log(`Returning existing running sync status for chain ${chainId}`);
			return c.json({
				success: true,
				data: existingStatus,
			});
		}

		// For completed/failed syncs or no sync, attempt to start a new sync
		// The rate limiting logic will handle whether it's allowed

		// Attempt to start sync (may be new or return rate limit)
		console.log(`Attempting to start sync process for chain ${chainId}`);
		const syncResult = await syncService.startSync(chainId);

		// Check if rate limited
		if (isRateLimitError(syncResult)) {
			return c.json({
				success: false,
				error: "Rate limit exceeded",
				data: {
					rateLimited: true,
					chainId: syncResult.chainId,
					remainingTime: syncResult.remainingTime,
					message: syncResult.message,
				},
			}, 429); // 429 Too Many Requests
		}

		return c.json({
			success: true,
			data: syncResult,
		});
	} catch (error) {
		// Handle validation errors
		if (error instanceof z.ZodError) {
			return c.json({
				error: "Invalid parameters ",
				details: error.issues.map((issue) => issue.message)
			}, 400);
		}

		console.error(`Error in sync endpoint:`, error);
		return c.json({
			error: "Internal server error",
			message: error instanceof Error ? error.message : "Unknown error"
		}, 500);
	}
});

// Sync status endpoint - only returns current status, doesn't trigger sync
app.get("/sync/:chainId/status", async (c) => {
	try {
		// Validate chainId parameter
		const { chainId } = syncParamsSchema.parse({
			chainId: c.req.param("chainId"),
		});

		// Get current sync status
		const syncStatus = syncService.getSyncStatus(chainId);

		if (!syncStatus) {
			return c.json({
				success: true,
				data: null,
				message: `No sync process found for chain ${chainId}`,
			});
		}

		return c.json({
			success: true,
			data: syncStatus,
		});
	} catch (error) {
		// Handle validation errors
		if (error instanceof z.ZodError) {
			return c.json({
				error: "Invalid parameters ",
				details: error.issues.map((issue) => issue.message)
			}, 400);
		}

		console.error(`Error in sync status endpoint:`, error);
		return c.json({
			error: "Internal server error",
			message: error instanceof Error ? error.message : "Unknown error"
		}, 500);
	}
});



// // Route to search token images by symbol
// app.get("/symbol/:symbol", async (c) => {
// 	try {
// 		// Validate parameters
// 		const { symbol, chainId } = symbolSearchSchema.parse({
// 			symbol: c.req.param("symbol"),
// 			chainId: c.req.query("chainId"), // Optional query parameter
// 		});

// 		console.log(`Searching for token image by symbol: ${symbol}${chainId ? ` on chain ${chainId}` : ''}`);

// 		// Get the token list provider
// 		const tokenListProvider = syncService.getImageProviders().getTokenListProvider();
// 		if (!tokenListProvider) {
// 			return c.json({
// 				error: "Token list provider not available"
// 			}, 503);
// 		}

// 		// Search for image by symbol
// 		const imageResult = await tokenListProvider.findImageBySymbol(symbol, chainId);

// 		if (!imageResult || !imageResult.url) {
// 			return c.json({
// 				error: "Token image not found",
// 				message: `No image found for symbol "${symbol}"${chainId ? ` on chain ${chainId}` : ''}`
// 			}, 404);
// 		}

// 		// Fetch the image from the URL
// 		console.log(`Fetching image from: ${imageResult.url}`);
// 		const imageResponse = await fetch(imageResult.url);

// 		if (!imageResponse.ok) {
// 			return c.json({
// 				error: "Failed to fetch image",
// 				message: `Failed to fetch image from ${imageResult.url}`
// 			}, 502);
// 		}

// 		// Get the image data
// 		const imageBuffer = await imageResponse.arrayBuffer();
// 		const contentType = getMimeType(imageResult.extension);

// 		return new Response(new Uint8Array(imageBuffer), {
// 			headers: {
// 				"Content-Type": contentType,
// 				"Cache-Control": "public, max-age=3600", // Cache for 1 hour
// 				"X-Token-Provider": imageResult.provider,
// 				"X-Token-Extension": imageResult.extension,
// 			},
// 		});
// 	} catch (error) {
// 		// Handle validation errors
// 		if (error instanceof z.ZodError) {
// 			return c.json({
// 				error: "Invalid parameters",
// 				details: error.issues.map((issue) => issue.message)
// 			}, 400);
// 		}

// 		console.error(`Error serving image by symbol:`, error);
// 		return c.json({
// 			error: "Internal server error",
// 			message: error instanceof Error ? error.message : "Unknown error"
// 		}, 500);
// 	}
// });

// Route to serve token images
app.get("/:chainId/:address", async (c) => {
	try {
		// Validate parameters
		const { chainId, address } = paramsSchema.parse({
			chainId: c.req.param("chainId"),
			address: c.req.param("address"),
		});

		// First, try to get image from storage (S3 or local depending on config)
		const storedImage = await getImageFromStorage(chainId, address);

		if (storedImage) {
			return new Response(new Uint8Array(storedImage.buffer), {
				headers: {
					"Content-Type": storedImage.contentType,
					"Cache-Control": "public, max-age=86400",
				},
			});
		}

		// If not found in storage, return default image
		const defaultImagePath = join(process.cwd(), "images", "default.png");
		const defaultImageBuffer = await readFile(defaultImagePath);

		// Get the correct MIME type for the default image based on file extension
		const fileExtension = defaultImagePath.split('.').pop() || "png";
		const defaultContentType = getMimeType(fileExtension);

		return new Response(new Uint8Array(defaultImageBuffer), {
			headers: {
				"Content-Type": defaultContentType,
				"Cache-Control": "public, max-age=86400",
			},
		});
	} catch (error) {
		// Handle validation errors
		if (error instanceof z.ZodError) {
			return c.json({
				error: "Invalid parameters",
				details: error.issues.map((issue) => issue.message)
			}, 400);
		}

		console.error(`Error serving image:`, error);
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
