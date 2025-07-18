import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

interface TokenData {
	chain: string;
	chainId: string;
	contractAddress: string;
}

interface CoinGeckoResponse {
	image: {
		thumb: string;
		small: string;
		large: string;
	};
}

interface EulerToken {
	address: string;
	symbol: string;
	name: string;
	decimals: number;
}

const API_KEY = process.env.COINGECKO_API_KEY;
const BASE_URL = "https://pro-api.coingecko.com/api/v3/coins";
const EULER_API_URL = "https://index-dev.euler.finance/v1/tokens";

const SUPPORTED_CHAIN_IDS = [
	"1",
	"8453",
	"1923",
	"146",
	"60808",
	"80094",
	"43114",
	"56",
	"130",
];

const CHAIN_ID_TO_COINGECKO_ID: Record<string, string> = {
	"1": "ethereum",
	"8453": "base",
	"1923": "sonic",
	"146": "sonic",
	"60808": "bob",
	"80094": "zksync",
	"43114": "avalanche",
	"56": "binance-smart-chain",
	"130": "unichain",
};

async function fetchTokenImage(
	chain: string,
	contractAddress: string,
): Promise<string | null> {
	if (!API_KEY) {
		console.error("COINGECKO_API_KEY environment variable is required");
		return null;
	}

	const url = `${BASE_URL}/${chain}/contract/${contractAddress}`;

	try {
		const response = await fetch(url, {
			headers: {
				"x-cg-pro-api-key": API_KEY,
			},
		});

		if (!response.ok) {
			console.error(
				`Failed to fetch token data for ${chain}/${contractAddress}: ${response.status}`,
			);
			return null;
		}

		const data: CoinGeckoResponse = await response.json();
		return data.image?.large || null;
	} catch (error) {
		console.error(
			`Error fetching token data for ${chain}/${contractAddress}:`,
			error,
		);
		return null;
	}
}

async function downloadImage(
	imageUrl: string,
	outputPath: string,
): Promise<boolean> {
	try {
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
			console.error(`Failed to download image: ${response.status}`);
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

async function processToken(
	chain: string,
	chainId: string,
	contractAddress: string,
): Promise<boolean> {
	console.log(`Processing ${chain}/${contractAddress}`);

	const imageUrl = await fetchTokenImage(chain, contractAddress);
	if (!imageUrl) {
		console.error(`No image found for ${chain}/${contractAddress}`);
		return false;
	}

	const outputPath = join(process.cwd(), chainId, contractAddress, "image.png");
	const success = await downloadImage(imageUrl, outputPath);

	if (success) {
		console.log(`Successfully saved image to ${outputPath}`);
	}

	return success;
}

async function fetchTokensFromEuler(chainId: string): Promise<EulerToken[]> {
	try {
		const response = await fetch(`${EULER_API_URL}?chainId=${chainId}`);

		if (!response.ok) {
			console.error(
				`Failed to fetch tokens for chain ${chainId}: ${response.status}`,
			);
			return [];
		}

		const tokens: EulerToken[] = await response.json();
		console.log(`Fetched ${tokens.length} tokens for chain ${chainId}`);
		return tokens;
	} catch (error) {
		console.error(`Error fetching tokens for chain ${chainId}:`, error);
		return [];
	}
}

async function fetchAllTokens(): Promise<TokenData[]> {
	const allTokens: TokenData[] = [];

	for (const chainId of SUPPORTED_CHAIN_IDS) {
		const coingeckoChainId = CHAIN_ID_TO_COINGECKO_ID[chainId];
		if (!coingeckoChainId) {
			console.warn(`No CoinGecko chain ID mapping for chain ${chainId}`);
			continue;
		}

		const tokens = await fetchTokensFromEuler(chainId);

		for (const token of tokens) {
			allTokens.push({
				chain: coingeckoChainId,
				chainId: chainId,
				contractAddress: token.address.toLowerCase(),
			});
		}

		// Add delay between chain requests
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	console.log(`Total tokens to process: ${allTokens.length}`);
	return allTokens;
}

async function processBatch(
	tokens: TokenData[],
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

		const batchPromises = batch.map((token) =>
			processToken(token.chain, token.chainId, token.contractAddress),
		);

		const results = await Promise.allSettled(batchPromises);

		results.forEach((result, index) => {
			if (result.status === "fulfilled" && result.value) {
				successCount++;
			} else {
				failCount++;
				if (result.status === "rejected") {
					console.error(
						`Token ${batch[index].contractAddress} failed:`,
						result.reason,
					);
				}
			}
		});

		console.log(
			`Batch ${batchNumber} completed. Progress: ${i + batch.length}/${totalTokens} tokens`,
		);

		// Wait 1 second between batches to respect rate limits (20 req/s)
		if (i + batchSize < tokens.length) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	console.log(`\nCompleted: ${successCount} successful, ${failCount} failed`);
}

async function main() {
	console.log("Starting token image fetch process...");

	const tokens = await fetchAllTokens();

	if (tokens.length === 0) {
		console.log("No tokens found to process");
		return;
	}

	console.log(`Processing ${tokens.length} tokens in batches of 20 (20 req/s)`);
	await processBatch(tokens);
}

if (import.meta.main) {
	main().catch(console.error);
}
