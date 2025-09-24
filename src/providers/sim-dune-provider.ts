import type { ImageProvider, ImageResult } from "./interface";

// Sim Dune API interfaces
interface SimDuneTokenInfo {
    contract_address?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    logo_uri?: string;
    chain_id?: number;
    // Add other fields that might be in the response
    [key: string]: any;
}

interface SimDuneResponse {
    data?: SimDuneTokenInfo | SimDuneTokenInfo[];
    error?: string;
    message?: string;
}

/**
 * SimDuneProvider - fetches token metadata from Sim Dune API
 * Only available if SIM_DUNE_API_KEY is set in environment variables
 */
export class SimDuneProvider implements ImageProvider {
    name = "sim-dune";
    private apiKey: string;
    private baseUrl = "https://api.sim.dune.com/v1/evm/token-info";

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.SIM_DUNE_API_KEY || "";
        if (!this.apiKey) {
            console.warn("Sim Dune API key not provided - provider will be disabled");
        }
    }

    async fetchImage(chainId: number, address: string): Promise<ImageResult | null> {
        if (!this.apiKey) {
            return null;
        }

        try {
            // Build the URL with query parameters
            const url = new URL(`${this.baseUrl}/${address.toLowerCase()}`);
            url.searchParams.append('chain_ids', chainId.toString());

            const response = await fetch(url.toString(), {
                method: "GET",
                headers: {
                    "X-Sim-Api-Key": this.apiKey,
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                console.error(`Sim Dune API error: ${response.status} ${response.statusText}`);
                return null;
            }

            const data: SimDuneResponse = await response.json();

            if (data.error) {
                console.error(`Sim Dune API error for ${chainId}/${address}:`, data.error);
                return null;
            }

            // Handle the response data (could be single object or array)
            let tokenInfo: SimDuneTokenInfo | null = null;

            if (Array.isArray(data.data)) {
                // If it's an array, find the token for our specific chain
                tokenInfo = data.data.find(token => token.chain_id === chainId) || data.data[0];
            } else if (data.data) {
                tokenInfo = data.data;
            }

            if (!tokenInfo?.logo_uri) {
                return null;
            }

            // Determine extension from URL
            const extension = this.getExtensionFromUrl(tokenInfo.logo_uri);

            console.log(`Found token image via Sim Dune for ${chainId}/${address}: ${tokenInfo.logo_uri}`);

            return {
                url: tokenInfo.logo_uri,
                provider: this.name,
                extension,
            };
        } catch (error) {
            console.error(`Sim Dune provider error for ${chainId}/${address}:`, error);
            return null;
        }
    }

    private getExtensionFromUrl(url: string): string {
        try {
            const pathname = new URL(url).pathname;
            const extension = pathname.split('.').pop()?.toLowerCase();

            // Map common extensions
            switch (extension) {
                case 'png':
                case 'jpg':
                case 'jpeg':
                case 'webp':
                case 'svg':
                case 'gif':
                    return extension;
                default:
                    return 'png'; // Default fallback
            }
        } catch {
            return 'png';
        }
    }

    // Utility method to check if provider is available
    isAvailable(): boolean {
        return !!this.apiKey;
    }
}
