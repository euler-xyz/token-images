import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isAddress } from "viem";
import { getImageFromS3, getMimeType } from "./services/image-s3-service";
import { SyncService } from "./services/sync-service";

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

// Sync service instance
const syncService = new SyncService();


// Sync endpoint - RPC style: triggers sync or returns current status
app.get("/sync/:chainId", async (c) => {
	try {
		// Validate chainId parameter
		const { chainId } = syncParamsSchema.parse({
			chainId: c.req.param("chainId"),
		});

		// Check if sync is already running or completed for this chainId
		const existingStatus = syncService.getSyncStatus(chainId);

		if (existingStatus) {
			console.log(`Returning existing sync status for chain ${chainId}: ${existingStatus.status}`);
			return c.json({
				success: true,
				data: existingStatus,
			});
		}

		// No existing sync, start a new one
		console.log(`Starting new sync process for chain ${chainId}`);
		const syncStatus = await syncService.startSync(chainId);

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

// Route to serve token images
app.get("/token/:chainId/:address", async (c) => {
	try {
		// Validate parameters
		const { chainId, address } = paramsSchema.parse({
			chainId: c.req.param("chainId"),
			address: c.req.param("address"),
		});

		// First, try to get image from S3
		const s3Image = await getImageFromS3(chainId, address);

		if (s3Image) {
			return new Response(new Uint8Array(s3Image.buffer), {
				headers: {
					"Content-Type": s3Image.contentType,
					"Cache-Control": "public, max-age=86400",
				},
			});
		}

		// If not found in S3, return default image
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
