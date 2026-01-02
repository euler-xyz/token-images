import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

interface TokenMeta {
    isPendlePT?: boolean;
    pendleMarket?: string;
    [key: string]: unknown;
}

interface TokenListEntry {
    addressInfo: string;
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string;
    meta: TokenMeta;
}

// Chain ID to tokenlist filename mapping
const CHAIN_ID_TO_TOKENLIST: Record<number, string> = {
    1: "ethereumTokenList.json",
    42161: "arbitrumTokenList.json",
    8453: "baseTokenList.json",
    43114: "avalancheTokenList.json",
    56: "bscTokenList.json",
    146: "sonicTokenList.json",
    1923: "plasmaTokenList.json",
    80084: "bartioTokenList.json",
    80094: "berachainTokenList.json",
    60808: "bobTokenList.json",
    59144: "lineaTokenList.json",
    5000: "mantleTokenList.json",
    1868: "swellTokenList.json",
    130: "unichainTokenList.json",
    2741: "tacTokenList.json",
    57073: "inkTokenList.json",
    2911: "hyperevmTokenList.json",
    10143: "monadTokenList.json",
};

// Cache for token lists (chainId -> { data, timestamp })
const tokenListCache: Map<number, { data: TokenListEntry[]; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load token list for a chain (with caching)
 */
async function loadTokenList(chainId: number): Promise<TokenListEntry[]> {
    const now = Date.now();
    const cached = tokenListCache.get(chainId);

    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
        return cached.data;
    }

    const filename = CHAIN_ID_TO_TOKENLIST[chainId];
    if (!filename) {
        return [];
    }

    const filePath = join(process.cwd(), ".data", filename);
    if (!existsSync(filePath)) {
        return [];
    }

    try {
        const content = await readFile(filePath, "utf-8");
        const data = JSON.parse(content) as TokenListEntry[];
        tokenListCache.set(chainId, { data, timestamp: now });
        return data;
    } catch (error) {
        console.error(`Error loading tokenlist for chain ${chainId}:`, error);
        return [];
    }
}

// Exception list: PT addresses that should get the ring effect even without isPendlePT in tokenlist
const PENDLE_PT_EXCEPTIONS = new Set([
    "0xb6168f597cd37a232cb7cb94cd1786be20ead156", // cross-chain pt-cusd
]);

/**
 * Check if a token is a Pendle PT token
 */
export async function isPendlePT(chainId: number, address: string): Promise<boolean> {
    const normalizedAddress = address.toLowerCase();

    // Check exceptions list first (for PTs not in tokenlist)
    if (PENDLE_PT_EXCEPTIONS.has(normalizedAddress)) {
        return true;
    }

    const tokenList = await loadTokenList(chainId);

    const token = tokenList.find(
        (t) => t.addressInfo.toLowerCase() === normalizedAddress
    );

    return token?.meta?.isPendlePT === true;
}

/**
 * Check if a token has a local image override in the images/ folder
 */
export function hasLocalImageOverride(chainId: number, address: string): boolean {
    const tokenDir = join(process.cwd(), "images", chainId.toString(), address.toLowerCase());
    return existsSync(tokenDir);
}

/**
 * Check if a token is a Pendle PT with a local image override
 */
export async function isPendlePTWithLocalOverride(chainId: number, address: string): Promise<boolean> {
    // First check local override (fast filesystem check)
    if (!hasLocalImageOverride(chainId, address)) {
        return false;
    }

    // Then check if it's a Pendle PT
    return isPendlePT(chainId, address);
}
