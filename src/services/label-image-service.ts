import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SAFE_LABEL_FILENAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const LABEL_IMAGE_DIRECTORY = join(process.cwd(), "images", "labels");

export type LabelImage = {
	buffer: Uint8Array;
	contentType: string;
};

export function isSafeLabelFilename(filename: string): boolean {
	return filename.length <= 255 && filename !== "." && filename !== ".." && SAFE_LABEL_FILENAME.test(filename);
}

export async function getLabelImage(filename: string): Promise<LabelImage | null> {
	if (!isSafeLabelFilename(filename)) {
		throw new TypeError("Invalid label image filename");
	}

	try {
		const buffer = new Uint8Array(await readFile(join(LABEL_IMAGE_DIRECTORY, filename)));
		return {
			buffer,
			contentType: detectImageContentType(buffer),
		};
	} catch (error) {
		if (isMissingFileError(error)) return null;
		throw error;
	}
}

function detectImageContentType(buffer: Uint8Array): string {
	if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return "image/png";
	}
	if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
		return "image/jpeg";
	}
	if (hasPrefix(buffer, [0x47, 0x49, 0x46, 0x38])) {
		return "image/gif";
	}
	if (
		hasPrefix(buffer, [0x52, 0x49, 0x46, 0x46]) &&
		buffer.length >= 12 &&
		String.fromCharCode(...buffer.slice(8, 12)) === "WEBP"
	) {
		return "image/webp";
	}

	const beginning = new TextDecoder().decode(buffer.slice(0, 4096)).replace(/^\uFEFF/, "").trimStart();
	if (/<svg(?:\s|>)/i.test(beginning)) {
		return "image/svg+xml";
	}

	throw new Error("Label asset is not a supported image");
}

function hasPrefix(buffer: Uint8Array, prefix: number[]): boolean {
	return prefix.every((byte, index) => buffer[index] === byte);
}

function isMissingFileError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}
