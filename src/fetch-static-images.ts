import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";

interface StaticListToken {
	addressInfo: string;
	chainId: number;
	name: string;
	symbol: string;
	decimals: number;
	logoURI: string;
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	meta: Record<string, any>;
}

interface ProcessedToken {
	address: string;
	chainId: string;
	logoURI: string;
}

async function downloadImage(
	imageUrl: string,
	outputPath: string,
): Promise<boolean> {
	try {
		// Skip local paths that start with /tokens/
		if (imageUrl.startsWith("/tokens/")) {
			console.log(`Skipping local path: ${imageUrl}`);
			return false;
		}

		// Validate URL
		if (!imageUrl || imageUrl.trim() === "") {
			console.error("Invalid or empty image URL");
			return false;
		}

		// Basic URL validation
		try {
			new URL(imageUrl);
		} catch {
			console.error(`Invalid URL format: ${imageUrl}`);
			return false;
		}

		const response = await fetch(imageUrl);

		if (!response.ok) {
			console.error(
				`Failed to download image: ${response.status} - ${imageUrl}`,
			);
			return false;
		}

		const buffer = await response.arrayBuffer();
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, new Uint8Array(buffer));

		return true;
	} catch (error) {
		console.error("Error downloading image:", error);
		return false;
	}
}

function getFileExtension(url: string): string {
	try {
		const parsedUrl = new URL(url);
		const pathname = parsedUrl.pathname;
		const ext = pathname.split(".").pop()?.toLowerCase();

		// Map common extensions
		if (ext && ["png", "jpg", "jpeg", "webp", "svg"].includes(ext)) {
			return `.${ext}`;
		}
	} catch (error) {
		// URL parsing failed, default to .png
	}

	// Default to .png if no extension found or parsing failed
	return ".png";
}

async function processStaticListFile(
	filePath: string,
): Promise<ProcessedToken[]> {
	try {
		const content = await readFile(filePath, "utf-8");
		const tokens: StaticListToken[] = JSON.parse(content);
		const processedTokens: ProcessedToken[] = [];

		for (const token of tokens) {
			const { addressInfo, chainId, logoURI } = token;

			if (!addressInfo || !chainId || !logoURI) {
				console.log(`Skipping token with missing data: ${token.symbol}`);
				continue;
			}

			// Skip local paths
			if (logoURI.startsWith("/tokens/")) {
				console.log(`Skipping local path for ${token.symbol}: ${logoURI}`);
				continue;
			}

			processedTokens.push({
				address: addressInfo.toLowerCase(),
				chainId: chainId.toString(),
				logoURI,
			});
		}

		return processedTokens;
	} catch (error) {
		console.error(`Error processing file ${filePath}:`, error);
		return [];
	}
}

async function processToken(token: ProcessedToken): Promise<boolean> {
	console.log(`Processing ${token.chainId}/${token.address}`);

	const extension = getFileExtension(token.logoURI);
	const tokenDir = join(
		process.cwd(),
		token.chainId,
		token.address,
	);
	const outputPath = join(tokenDir, `image${extension}`);

	// Delete existing image files with different extensions
	if (existsSync(tokenDir)) {
		const existingFiles = await readdir(tokenDir);
		const imageFiles = existingFiles.filter(file => file.startsWith('image.'));
		
		for (const imageFile of imageFiles) {
			const existingImagePath = join(tokenDir, imageFile);
			try {
				await unlink(existingImagePath);
				console.log(`Deleted existing image: ${existingImagePath}`);
			} catch (error) {
				console.error(`Failed to delete ${existingImagePath}:`, error);
			}
		}
	}

	const success = await downloadImage(token.logoURI, outputPath);

	if (success) {
		console.log(`Successfully saved image to ${outputPath}`);
	}

	return success;
}

async function processBatch(
	tokens: ProcessedToken[],
	batchSize = 20,
): Promise<void> {
	let successCount = 0;
	let failCount = 0;
	const totalTokens = tokens.length;

	for (let i = 0; i < tokens.length; i += batchSize) {
		const batch = tokens.slice(i, i + batchSize);
		const batchNumber = Math.floor(i / batchSize) + 1;
		const totalBatches = Math.ceil(tokens.length / batchSize);

		console.log(
			`Processing batch ${batchNumber}/${totalBatches} (${batch.length} tokens)`,
		);

		const batchPromises = batch.map((token) => processToken(token));
		const results = await Promise.allSettled(batchPromises);

		results.forEach((result, index) => {
			if (result.status === "fulfilled" && result.value) {
				successCount++;
			} else {
				failCount++;
				if (result.status === "rejected") {
					console.error(`Token ${batch[index].address} failed:`, result.reason);
				}
			}
		});

		console.log(
			`Batch ${batchNumber} completed. Progress: ${i + batch.length}/${totalTokens} tokens`,
		);

		// Wait 1 second between batches to avoid overwhelming servers
		if (i + batchSize < tokens.length) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	console.log(`\nCompleted: ${successCount} successful, ${failCount} failed`);
}

async function main() {
	console.log("Starting static list image fetch process...");

	const staticListDir = join(process.cwd(), "src", "staticList");

	try {
		const files = await readdir(staticListDir);
		const jsonFiles = files.filter((file) => file.endsWith(".json"));

		console.log(`Found ${jsonFiles.length} JSON files to process`);

		let allTokens: ProcessedToken[] = [];

		for (const jsonFile of jsonFiles) {
			const filePath = join(staticListDir, jsonFile);
			console.log(`Processing ${jsonFile}...`);

			const tokens = await processStaticListFile(filePath);
			allTokens = allTokens.concat(tokens);

			console.log(
				`Found ${tokens.length} tokens with remote images in ${jsonFile}`,
			);
		}

		if (allTokens.length === 0) {
			console.log("No tokens with remote images found to process");
			return;
		}

		console.log(`Processing ${allTokens.length} tokens in batches of 20`);
		await processBatch(allTokens);
	} catch (error) {
		console.error("Error reading static list directory:", error);
	}
}

if (import.meta.main) {
	main().catch(console.error);
}
