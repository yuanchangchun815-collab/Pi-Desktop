// Builds a multi-size Windows .ico from the generated icon.png.
// ICO format embeds PNG data for each size (works on modern Windows).
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, "../../build");

function getPngOfSize(size) {
	const scaled = path.join(buildDir, `_tmp_${size}.png`);
	execFileSync("sips", ["-z", String(size), String(size), path.join(buildDir, "icon.png"), "--out", scaled], { stdio: "ignore" });
	return { buf: readFileSync(scaled), size };
}

function main() {
	const sizes = [16, 32, 48, 256];
	const images = sizes.map(getPngOfSize);

	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type icon
	header.writeUInt16LE(images.length, 4);

	const entries = [];
	let offset = 6 + 16 * images.length;
	for (const img of images) {
		const e = Buffer.alloc(16);
		const dim = img.size >= 256 ? 0 : img.size;
		e[0] = dim;
		e[1] = dim;
		e[2] = 0;
		e[3] = 0;
		e.writeUInt16LE(1, 4);   // planes
		e.writeUInt16LE(32, 6);  // bpp
		e.writeUInt32LE(img.buf.length, 8);
		e.writeUInt32LE(offset, 12);
		entries.push(e);
		offset += img.buf.length;
	}
	const out = Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
	writeFileSync(path.join(buildDir, "icon.ico"), out);
	for (const s of sizes) {
		try { execFileSync("rm", ["-f", path.join(buildDir, `_tmp_${s}.png`)]); } catch {}
	}
	console.log("Wrote", path.join(buildDir, "icon.ico"), out.length, "bytes");
}

main();
