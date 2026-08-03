import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const SAFE_LABEL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const LABEL_IMAGE_DIRECTORY = join(process.cwd(), "images", "labels");
const SUPPORTED_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

let labelImageIndex: Promise<Map<string, string>> | undefined;

export type LabelImage = {
	buffer: Uint8Array;
	contentType: string;
};

export function isSafeLabelName(name: string): boolean {
	return name.length <= 255 && name !== "." && name !== ".." && SAFE_LABEL_NAME.test(name);
}

export async function getLabelImage(name: string): Promise<LabelImage | null> {
	if (!isSafeLabelName(name)) {
		throw new TypeError("Invalid label image name");
	}

	const filename = (await getLabelImageIndex()).get(name);
	if (!filename) return null;

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

async function getLabelImageIndex(): Promise<Map<string, string>> {
	labelImageIndex ??= buildLabelImageIndex();
	return labelImageIndex;
}

async function buildLabelImageIndex(): Promise<Map<string, string>> {
	const index = new Map<string, string>();
	for (const filename of await readdir(LABEL_IMAGE_DIRECTORY)) {
		const extension = extname(filename).toLowerCase();
		if (!SUPPORTED_EXTENSIONS.has(extension)) continue;

		const name = filename.slice(0, -extension.length);
		if (index.has(name)) {
			throw new Error(`Label assets have duplicate name ${JSON.stringify(name)}`);
		}
		index.set(name, filename);
	}
	return index;
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
