/**
 * Utility function to add delay between API calls to avoid rate limiting
 * @param ms - Delay in milliseconds
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT_CONFIG = {
    FETCH_IMAGE_DELAY_MS: 2000,
    // Delay between provider calls in the fetchImage chain
    PROVIDER_DELAY_MS: 1000,

} as const;
