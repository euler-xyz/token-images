import { ImageProviderManager } from "./fetch-image-service";
import { bulkCheckImagesInS3, uploadImageToS3 } from "./image-s3-service";
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
}

export class SyncService {
    private imageProviders: ImageProviderManager;
    private eulerApiUrl: string;
    private syncStatuses: Map<number, SyncStatus> = new Map();

    constructor() {
        this.imageProviders = new ImageProviderManager();
        this.eulerApiUrl = process.env.EULER_API_URL || "https://index-dev.euler.finance";

        console.log(`Using Euler API URL: ${this.eulerApiUrl}`);
    }

    getSyncStatus(chainId: number): SyncStatus | null {
        return this.syncStatuses.get(chainId) || null;
    }

    private updateSyncStatus(chainId: number, updates: Partial<SyncStatus>): void {
        const current = this.syncStatuses.get(chainId);
        if (current) {
            this.syncStatuses.set(chainId, { ...current, ...updates });
        }
    }

    async startSync(chainId: number): Promise<SyncStatus> {
        // Check if sync is already running for this chainId
        const existingStatus = this.syncStatuses.get(chainId);
        if (existingStatus && existingStatus.status === 'running') {
            return existingStatus;
        }

        // Initialize sync status
        const syncStatus: SyncStatus = {
            chainId,
            status: 'running',
            startTime: Date.now(),
            progress: {
                phase: 'initializing',
                current: 0,
                total: 0,
            },
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

            // 2. Bulk check which images already exist in S3
            this.updateSyncStatus(chainId, {
                progress: { phase: 'checking S3', current: 0, total: tokens.length }
            });

            const tokenList = tokens.map(token => ({
                chainId,
                address: token.address.toLowerCase(),
            }));

            console.log(`Checking S3 for existing images...`);
            console.log(`AWS Region: ${process.env.AWS_REGION || 'not set'}`);
            console.log(`AWS Access Key: ${process.env.AWS_ACCESS_KEY_ID ? 'set' : 'not set'}`);

            const existenceChecks = await bulkCheckImagesInS3(tokenList);
            console.log(`S3 check completed`);

            const missingFromS3 = existenceChecks.filter(check => !check.exists);
            const existingInS3Count = existenceChecks.length - missingFromS3.length;

            console.log(`Found ${existingInS3Count} existing images in S3, ${missingFromS3.length} missing from S3`);

            // 3. For tokens missing from S3, check if they exist locally
            this.updateSyncStatus(chainId, {
                progress: { phase: 'checking local images', current: 0, total: missingFromS3.length }
            });

            console.log(`Checking for local images...`);
            const localProvider = this.imageProviders.getLocalProvider();
            const localChecks = localProvider
                ? await localProvider.bulkCheckLocalImages(missingFromS3)
                : missingFromS3.map(token => ({ ...token, hasLocal: false }));

            const hasLocalImages = localChecks.filter(check => check.hasLocal);
            const stillMissingTokens = localChecks.filter(check => !check.hasLocal);

            console.log(`Found ${hasLocalImages.length} local images to migrate, ${stillMissingTokens.length} still missing`);

            // 4. Migrate local images to S3
            this.updateSyncStatus(chainId, {
                progress: { phase: 'migrating local images', current: 0, total: hasLocalImages.length }
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
                existingImages: existingInS3Count,
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
        const status = await this.startSync(chainId);

        // If sync was already running, wait for it to complete
        if (status.status === 'running') {
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

        console.log(`Migrating ${tokensWithLocal.length} local images to S3...`);

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

                    // Upload to S3 with metadata indicating it was migrated from local
                    const uploadSuccess = await uploadImageToS3(
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

        // Process in batches to respect rate limits
        const batchSize = 10;
        for (let i = 0; i < missingTokens.length; i += batchSize) {
            const batch = missingTokens.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missingTokens.length / batchSize)}`);

            const batchPromises = batch.map(async (token) => {
                try {
                    // Try to fetch image from providers
                    const imageResult = await this.imageProviders.fetchImage(token.chainId, token.address);

                    if (!imageResult) {
                        details.push({
                            address: token.address,
                            status: 'failed',
                        });
                        return { success: false };
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
                        return { success: false };
                    }

                    // Upload to S3 with metadata
                    const uploadSuccess = await uploadImageToS3(
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
                        return { success: true };
                    } else {
                        details.push({
                            address: token.address,
                            status: 'failed',
                            provider: imageResult.provider,
                        });
                        return { success: false };
                    }
                } catch (error) {
                    console.error(`Error processing token ${token.address}:`, error);
                    details.push({
                        address: token.address,
                        status: 'failed',
                    });
                    return { success: false };
                }
            });

            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach((result) => {
                if (result.status === 'fulfilled' && result.value.success) {
                    downloaded++;
                } else {
                    failed++;
                }
            });

            // Add delay between batches to respect rate limits
            if (i + batchSize < missingTokens.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
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
