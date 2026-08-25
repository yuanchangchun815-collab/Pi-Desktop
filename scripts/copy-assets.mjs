import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function main() {
	const rendererIn = path.join(root, "renderer");
	const rendererOut = path.join(root, "dist", "renderer");
	await mkdir(rendererOut, { recursive: true });

	// Copy static renderer assets (html, css).
	for (const file of ["index.html", "styles.css"]) {
		await cp(path.join(rendererIn, file), path.join(rendererOut, file));
	}
	console.log("Copied renderer static assets to dist/renderer");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
