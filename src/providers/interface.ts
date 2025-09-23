export interface ImageResult {
    url?: string;          // For remote images
    buffer?: Uint8Array;   // For local images
    provider: string;
    extension: string;
    path?: string;         // For local images - the file path
}




export interface ImageProvider {
    name: string;
    fetchImage(chainId: number, address: string): Promise<ImageResult | null>;
}