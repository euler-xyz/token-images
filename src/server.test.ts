import { describe, expect, test } from "bun:test";
import { app } from "./server";

describe("label images", () => {
	test("serves a label SVG with cache and content-safety headers", async () => {
		const response = await app.request("http://localhost/labels/euler");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/svg+xml");
		expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
		expect(response.headers.get("content-security-policy")).toContain("sandbox");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await response.text()).toContain("<svg");
	});

	test("uses the image contents for MIME detection", async () => {
		const response = await app.request("http://localhost/labels/coinshift");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
	});

	test("returns 404 without the token-image fallback", async () => {
		const response = await app.request("http://localhost/labels/missing");

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Label image not found" });
	});

	test("rejects unsafe filenames", async () => {
		const response = await app.request("http://localhost/labels/invalid!");

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid label image name" });
	});

	test("does not expose file-extension URLs", async () => {
		const response = await app.request("http://localhost/labels/euler.svg");

		expect(response.status).toBe(404);
	});
});
