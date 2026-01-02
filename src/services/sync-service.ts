import { delay, RATE_LIMIT_CONFIG } from "../utils";
import { ImageProviderManager } from "./fetch-image-service";
import { bulkCheckImagesInStorage, uploadImageToStorage, STORAGE_MODE } from "./image-storage-service";
export interface TokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
}

export interface SyncResult {
    chainId: number;
    totalTokens: number;
    existingImages: number;
    migratedFromLocal: number;
    downloadedImages: number;
    failedDownloads: number;
    duration: number;
    details: Array<{
        address: string;
        status: 'exists' | 'migrated' | 'downloaded' | 'failed';
        provider?: string;
    }>;
}

export interface SyncStatus {
    chainId: number;
    status: 'running' | 'completed' | 'failed';
    startTime: number;
    endTime?: number;
    progress?: {
        phase: string;
        current: number;
        total: number;
    };
    result?: SyncResult;
    error?: string;
    remainingTime?: number; // milliseconds until next sync is allowed
}

export interface RateLimitError {
    rateLimited: true;
    chainId: number;
    remainingTime: number; // milliseconds until next sync is allowed
    message: string;
}

export class SyncService {
    private imageProviders: ImageProviderManager;
    private eulerApiUrl: string;
    private syncStatuses: Map<number, SyncStatus> = new Map();
    private readonly RATE_LIMIT_MINUTES = 1;

    constructor() {
        this.imageProviders = new ImageProviderManager();
        this.eulerApiUrl = process.env.EULER_API_URL || "https://index-dev.euler.finance";

        console.log(`Using Euler API URL: ${this.eulerApiUrl}`);
    }

    getSyncStatus(chainId: number): SyncStatus | null {
        const status = this.syncStatuses.get(chainId);
        if (!status) {
            return null;
        }

        // Always include the current remaining time
        return {
            ...status,
            remainingTime: this.calculateRemainingTime(chainId)
        };
    }

    getImageProviders(): ImageProviderManager {
        return this.imageProviders;
    }

    getRateLimitInfo(chainId: number): { canSync: boolean; remainingTime: number; message?: string } {
        const rateLimitCheck = this.checkRateLimit(chainId);
        const remainingTime = this.calculateRemainingTime(chainId);

        if (rateLimitCheck) {
            return {
                canSync: false,
                remainingTime,
                message: rateLimitCheck.message,
            };
        }
        return {
            canSync: true,
            remainingTime,
            message: remainingTime > 0 ? `Can sync now, but next sync will be available in ${Math.ceil(remainingTime / (60 * 1000))} minute(s).` : "Can sync immediately."
        };
    }

    private updateSyncStatus(chainId: number, updates: Partial<SyncStatus>): void {
        const current = this.syncStatuses.get(chainId);
        if (current) {
            this.syncStatuses.set(chainId, { ...current, ...updates });
        }
    }

    private checkRateLimit(chainId: number): RateLimitError | null {
        const now = Date.now();
        const rateLimitMs = this.RATE_LIMIT_MINUTES * 60 * 1000;

        // Check if there's a sync currently running
        const currentStatus = this.syncStatuses.get(chainId);
        if (currentStatus && currentStatus.status === 'running') {
            // For running syncs, check against start time
            const timeDiff = now - currentStatus.startTime;
            if (timeDiff < rateLimitMs) {
                const remainingTime = rateLimitMs - timeDiff;
                const remainingMinutes = Math.ceil(remainingTime / (60 * 1000));

                return {
                    rateLimited: true,
                    chainId,
                    remainingTime,
                    message: `Sync is currently running. Started ${Math.floor(timeDiff / (60 * 1000))} minute(s) ago.`,
                };
            }
        }

        // Check if there's a completed/failed sync that's too recent
        if (currentStatus && (currentStatus.status === 'completed' || currentStatus.status === 'failed')) {
            const relevantTime = currentStatus.endTime || currentStatus.startTime;
            const timeDiff = now - relevantTime;

            if (timeDiff < rateLimitMs) {
                const remainingTime = rateLimitMs - timeDiff;
                const remainingMinutes = Math.ceil(remainingTime / (60 * 1000));

                return {
                    rateLimited: true,
                    chainId,
                    remainingTime,
                    message: `Rate limit exceeded. Last sync ${currentStatus.status} ${Math.floor(timeDiff / (60 * 1000))} minute(s) ago. Please wait ${remainingMinutes} more minute(s).`,
                };
            }
        }

        return null; // Rate limit passed
    }

    private isRateLimitError(result: SyncStatus | RateLimitError): result is RateLimitError {
        return 'rateLimited' in result && result.rateLimited === true;
    }

    private calculateRemainingTime(chainId: number): number {
        const now = Date.now();
        const rateLimitMs = this.RATE_LIMIT_MINUTES * 60 * 1000;
        const currentStatus = this.syncStatuses.get(chainId);

        if (!currentStatus) {
            return 0; // No previous sync, can sync immediately
        }

        if (currentStatus.status === 'running') {
            // For running syncs, calculate remaining time based on start time
            const timeDiff = now - currentStatus.startTime;
            return Math.max(0, rateLimitMs - timeDiff);
        }

        if (currentStatus.status === 'completed' || currentStatus.status === 'failed') {
            // For completed/failed syncs, calculate remaining time based on end time
            const relevantTime = currentStatus.endTime || currentStatus.startTime;
            const timeDiff = now - relevantTime;
            return Math.max(0, rateLimitMs - timeDiff);
        }

        return 0; // Default to no remaining time
    }

    async startSync(chainId: number): Promise<SyncStatus | RateLimitError> {
        // Check rate limit before starting new sync (this also handles running syncs)
        const rateLimitCheck = this.checkRateLimit(chainId);
        if (rateLimitCheck) {
            return rateLimitCheck;
        }

        // If we have a running sync that passed rate limit check, return it with remaining time
        const existingStatus = this.syncStatuses.get(chainId);
        if (existingStatus && existingStatus.status === 'running') {
            return {
                ...existingStatus,
                remainingTime: this.calculateRemainingTime(chainId)
            };
        }

        // Start a new sync (old sync was either completed/failed and > 10 min ago, or no previous sync)
        const now = Date.now();
        console.log(`Starting new sync for chain ${chainId}`);

        // Initialize sync status
        const syncStatus: SyncStatus = {
            chainId,
            status: 'running',
            startTime: now,
            progress: {
                phase: 'initializing',
                current: 0,
                total: 0,
            },
            remainingTime: this.RATE_LIMIT_MINUTES * 60 * 1000, // Full rate limit time for new sync
        };

        this.syncStatuses.set(chainId, syncStatus);

        // Start sync process asynchronously
        this.performSync(chainId).catch((error) => {
            console.error(`Sync failed for chain ${chainId}:`, error);
            this.updateSyncStatus(chainId, {
                status: 'failed',
                endTime: Date.now(),
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        });

        return syncStatus;
    }

    private async performSync(chainId: number): Promise<void> {
        const startTime = Date.now();
        console.log(`Starting sync for chain ${chainId}`);

        try {
            // 1. Fetch tokens from API
            this.updateSyncStatus(chainId, {
                progress: { phase: 'fetching tokens', current: 0, total: 1 }
            });

            console.log(`Fetching tokens from ${this.eulerApiUrl}/v1/tokens?chainId=${chainId}`);
            const tokens = await this.fetchTokensFromEuler(chainId);
            console.log(`Fetched ${tokens.length} tokens for chain ${chainId}`);

            if (tokens.length === 0) {
                const result: SyncResult = {
                    chainId,
                    totalTokens: 0,
                    existingImages: 0,
                    migratedFromLocal: 0,
                    downloadedImages: 0,
                    failedDownloads: 0,
                    duration: Date.now() - startTime,
                    details: [],
                };

                this.updateSyncStatus(chainId, {
                    status: 'completed',
                    endTime: Date.now(),
                    result,
                });
                return;
            }

            // 2. Bulk check which images already exist in storage
            this.updateSyncStatus(chainId, {
                progress: { phase: `checking ${STORAGE_MODE} storage`, current: 0, total: tokens.length }
            });

            const tokenList = tokens.map(token => ({
                chainId,
                address: token.address.toLowerCase(),
            }));

            console.log(`Checking ${STORAGE_MODE} storage for existing images...`);
            if (STORAGE_MODE === "s3") {
                console.log(`AWS Region: ${process.env.AWS_REGION || 'not set'}`);
                console.log(`AWS Access Key: ${process.env.EULER_AWS_ACCESS_KEY ? 'set' : 'not set'}`);
            }

            const existenceChecks = await bulkCheckImagesInStorage(tokenList);
            console.log(`Storage check completed`);

            const missingFromStorage = existenceChecks.filter(check => !check.exists);
            const existingInStorageCount = existenceChecks.length - missingFromStorage.length;

            console.log(`Found ${existingInStorageCount} existing images in ${STORAGE_MODE} storage, ${missingFromStorage.length} missing`);

            // 3. For tokens missing from storage, check if they exist in local source images
            this.updateSyncStatus(chainId, {
                progress: { phase: 'checking local source images', current: 0, total: missingFromStorage.length }
            });

            console.log(`Checking for local source images...`);
            const localProvider = this.imageProviders.getLocalProvider();
            const localChecks = localProvider
                ? await localProvider.bulkCheckLocalImages(missingFromStorage)
                : missingFromStorage.map(token => ({ ...token, hasLocal: false }));

            const hasLocalImages = localChecks.filter(check => check.hasLocal);
            const stillMissingTokens = localChecks.filter(check => !check.hasLocal);

            console.log(`Found ${hasLocalImages.length} local images to migrate, ${stillMissingTokens.length} still missing`);

            // 4. Migrate local source images to storage
            this.updateSyncStatus(chainId, {
                progress: { phase: 'migrating local source images', current: 0, total: hasLocalImages.length }
            });
            const migrationResults = await this.migrateLocalImages(hasLocalImages);

            // 5. Download and upload remaining missing images
            this.updateSyncStatus(chainId, {
                progress: { phase: 'downloading missing images', current: 0, total: stillMissingTokens.length }
            });
            const downloadResults = await this.downloadMissingImages(stillMissingTokens);

            // 6. Compile results
            const result: SyncResult = {
                chainId,
                totalTokens: tokens.length,
                existingImages: existingInStorageCount,
                migratedFromLocal: migrationResults.migrated,
                downloadedImages: downloadResults.downloaded,
                failedDownloads: migrationResults.failed + downloadResults.failed,
                duration: Date.now() - startTime,
                details: [
                    ...existenceChecks
                        .filter(check => check.exists)
                        .map(check => ({
                            address: check.address,
                            status: 'exists' as const,
                        })),
                    ...migrationResults.details,
                    ...downloadResults.details,
                ],
            };

            console.log(`Sync completed for chain ${chainId}: ${downloadResults.downloaded} downloaded, ${downloadResults.failed} failed`);

            // Update final status
            this.updateSyncStatus(chainId, {
                status: 'completed',
                endTime: Date.now(),
                result,
                progress: { phase: 'completed', current: tokens.length, total: tokens.length }
            });
        } catch (error) {
            console.error(`Sync failed for chain ${chainId}:`, error);
            this.updateSyncStatus(chainId, {
                status: 'failed',
                endTime: Date.now(),
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    // Keep the original method for backward compatibility, but mark as deprecated
    async syncTokenImages(chainId: number): Promise<SyncResult> {
        const result = await this.startSync(chainId);

        // Check if rate limited
        if (this.isRateLimitError(result)) {
            throw new Error(result.message);
        }

        // If sync was already running, wait for it to complete
        if (result.status === 'running') {
            return new Promise((resolve, reject) => {
                const checkStatus = () => {
                    const currentStatus = this.getSyncStatus(chainId);
                    if (!currentStatus) {
                        reject(new Error('Sync status lost'));
                        return;
                    }

                    if (currentStatus.status === 'completed' && currentStatus.result) {
                        resolve(currentStatus.result);
                    } else if (currentStatus.status === 'failed') {
                        reject(new Error(currentStatus.error || 'Sync failed'));
                    } else {
                        setTimeout(checkStatus, 1000);
                    }
                };
                checkStatus();
            });
        }

        // Wait for the newly started sync to complete
        return new Promise((resolve, reject) => {
            const checkStatus = () => {
                const currentStatus = this.getSyncStatus(chainId);
                if (!currentStatus) {
                    reject(new Error('Sync status lost'));
                    return;
                }

                if (currentStatus.status === 'completed' && currentStatus.result) {
                    resolve(currentStatus.result);
                } else if (currentStatus.status === 'failed') {
                    reject(new Error(currentStatus.error || 'Sync failed'));
                } else {
                    setTimeout(checkStatus, 1000);
                }
            };
            checkStatus();
        });
    }

    private async fetchTokensFromEuler(chainId: number): Promise<TokenInfo[]> {
        try {
            const response = await fetch(`${this.eulerApiUrl}/v1/tokens?chainId=${chainId}`);

            if (!response.ok) {
                console.error(`Failed to fetch tokens for chain ${chainId}: ${response.status}`);
                return [];
            }

            const tokens: TokenInfo[] = await response.json();
            return tokens;
        } catch (error) {
            console.error(`Error fetching tokens for chain ${chainId}:`, error);
            return [];
        }
    }

    private async migrateLocalImages(
        tokensWithLocal: Array<{ chainId: number; address: string }>
    ): Promise<{
        migrated: number;
        failed: number;
        details: Array<{
            address: string;
            status: 'migrated' | 'failed';
            provider?: string;
        }>;
    }> {
        let migrated = 0;
        let failed = 0;
        const details: Array<{
            address: string;
            status: 'migrated' | 'failed';
            provider?: string;
        }> = [];

        console.log(`Migrating ${tokensWithLocal.length} local source images to ${STORAGE_MODE} storage...`);

        // Process in batches for better performance
        const batchSize = 20;
        for (let i = 0; i < tokensWithLocal.length; i += batchSize) {
            const batch = tokensWithLocal.slice(i, i + batchSize);
            console.log(`Migrating batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tokensWithLocal.length / batchSize)}`);

            const batchPromises = batch.map(async (token) => {
                try {
                    const localProvider = this.imageProviders.getLocalProvider();
                    if (!localProvider) {
                        details.push({
                            address: token.address,
                            status: 'failed',
                        });
                        return { success: false };
                    }

                    const localImage = await localProvider.fetchImage(token.chainId, token.address);

                    if (!localImage || !localImage.buffer) {
                        details.push({
                            address: token.address,
                            status: 'failed',
                        });
                        return { success: false };
                    }

                    // Upload to storage with metadata indicating it was migrated from local
                    const uploadSuccess = await uploadImageToStorage(
                        token.chainId,
                        token.address,
                        localImage.buffer,
                        localImage.extension,
                        {
                            provider: 'local-migration',
                            downloadDate: new Date().toISOString(),
                            originalUrl: localImage.path || 'unknown',
                        }
                    );

                    if (uploadSuccess) {
                        details.push({
                            address: token.address,
                            status: 'migrated',
                            provider: 'local-migration',
                        });
                        return { success: true };
                    } else {
                        details.push({
                            address: token.address,
                            status: 'failed',
                            provider: 'local-migration',
                        });
                        return { success: false };
                    }
                } catch (error) {
                    console.error(`Error migrating local image for ${token.address}:`, error);
                    details.push({
                        address: token.address,
                        status: 'failed',
                        provider: 'local-migration',
                    });
                    return { success: false };
                }
            });

            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach((result) => {
                if (result.status === 'fulfilled' && result.value.success) {
                    migrated++;
                } else {
                    failed++;
                }
            });

            // Small delay between batches
            if (i + batchSize < tokensWithLocal.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        console.log(`Migration completed: ${migrated} migrated, ${failed} failed`);
        return { migrated, failed, details };
    }

    private async downloadMissingImages(
        missingTokens: Array<{ chainId: number; address: string }>
    ): Promise<{
        downloaded: number;
        failed: number;
        details: Array<{
            address: string;
            status: 'downloaded' | 'failed';
            provider?: string;
        }>;
    }> {
        let downloaded = 0;
        let failed = 0;
        const details: Array<{
            address: string;
            status: 'downloaded' | 'failed';
            provider?: string;
        }> = [];

        // Process tokens one by one (no batching)
        for (let i = 0; i < missingTokens.length; i++) {
            const token = missingTokens[i];
            console.log(`Processing token ${i + 1}/${missingTokens.length}: ${token.address}`);

            try {
                // add some delay between tokens
                await delay(RATE_LIMIT_CONFIG.FETCH_IMAGE_DELAY_MS);
                // Try to fetch image from providers
                const imageResult = await this.imageProviders.fetchImage(token.chainId, token.address);

                if (!imageResult) {
                    details.push({
                        address: token.address,
                        status: 'failed',
                    });
                    failed++;
                    continue;
                }

                // Get the image buffer (either download from URL or use existing buffer)
                let imageBuffer: Uint8Array | null = null;

                if (imageResult.buffer) {
                    // Local image - already have the buffer
                    imageBuffer = imageResult.buffer;
                } else if (imageResult.url) {
                    // Remote image - need to download
                    imageBuffer = await this.downloadImageBuffer(imageResult.url);
                }

                if (!imageBuffer) {
                    details.push({
                        address: token.address,
                        status: 'failed',
                        provider: imageResult.provider,
                    });
                    failed++;
                    continue;
                }

                // Upload to storage with metadata
                const uploadSuccess = await uploadImageToStorage(
                    token.chainId,
                    token.address,
                    imageBuffer,
                    imageResult.extension,
                    {
                        provider: imageResult.provider,
                        downloadDate: new Date().toISOString(),
                        originalUrl: imageResult.url || imageResult.path || 'unknown',
                    }
                );

                if (uploadSuccess) {
                    details.push({
                        address: token.address,
                        status: 'downloaded',
                        provider: imageResult.provider,
                    });
                    downloaded++;
                } else {
                    details.push({
                        address: token.address,
                        status: 'failed',
                        provider: imageResult.provider,
                    });
                    failed++;
                }
            } catch (error) {
                console.error(`Error processing token ${token.address}:`, error);
                details.push({
                    address: token.address,
                    status: 'failed',
                });
                failed++;
            }
        }

        return { downloaded, failed, details };
    }

    private async downloadImageBuffer(url: string): Promise<Uint8Array | null> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return null;
            }

            const arrayBuffer = await response.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        } catch (error) {
            console.error(`Error downloading image from ${url}:`, error);
            return null;
        }
    }
}
