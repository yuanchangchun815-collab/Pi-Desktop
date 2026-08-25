// Generates a high-res PNG app icon (1024x1024) for Pi Desktop.
// Self-contained: uses only node built-ins (zlib) + a tiny PNG encoder.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIZE = 1024;

// ---------- tiny PNG encoder (RGBA) ----------
function crc32(buf) {
	let c, table = crc32.table || (crc32.table = (() => {
		const t = new Int32Array(256);
		for (let n = 0; n < 256; n++) {
			c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			t[n] = c;
		}
		return t;
	})());
	let crc = -1;
	for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
	return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const typeBuf = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
	return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
	const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	// raw scanlines with filter byte 0
	const raw = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y++) {
		const rowStart = y * (1 + width * 4);
		raw[rowStart] = 0;
		rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
	}
	const idat = deflateSync(raw, { level: 9 });
	return Buffer.concat([
		sig,
		chunk("IHDR", ihdr),
		chunk("IDAT", idat),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// ---------- logo drawing ----------
// Rounded-rect SDF
function sdRoundedRect(px, py, cx, cy, half, r) {
	const dx = Math.abs(px - cx) - (half - r);
	const dy = Math.abs(py - cy) - (half - r);
	const ox = Math.max(dx, 0);
	const oy = Math.max(dy, 0);
	return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

// distance point->segment
function distSeg(px, py, x1, y1, x2, y2) {
	const dx = x2 - x1, dy = y2 - y1;
	const len2 = dx * dx + dy * dy;
	let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const W = SIZE, H = SIZE;
const buf = Buffer.alloc(W * H * 4);

// gradient background: top-left accent, bottom-right purple
const c1 = [79, 124, 255];   // #4f7cff
const c2 = [168, 85, 247];   // #a855f7
const cx = W / 2, cy = H / 2;
const half = W * 0.46;       // half-size of rounded rect
const cornerR = W * 0.18;

// "π" glyph geometry (in logo space, centered)
const topY = H * 0.44;
const stroke = W * 0.07;
const legH = H * 0.26;
const leftX = W * 0.30;
const rightX = W * 0.70;
// top horizontal bar from leftX to rightX at topY
const bar = { x1: leftX, y1: topY, x2: rightX, y2: topY };
// two legs
const legL = { x1: leftX, y1: topY, x2: leftX, y2: topY + legH };
const legR = { x1: rightX, y1: topY, x2: rightX, y2: topY + legH };

for (let y = 0; y < H; y++) {
	for (let x = 0; x < W; x++) {
		const i = (y * W + x) * 4;
		const d = sdRoundedRect(x, y, cx, cy, half, cornerR);
		const outside = d > 0;

		// glyph coverage (anti-aliased via smoothstep)
		const dr = Math.min(
			distSeg(x, y, bar.x1, bar.y1, bar.x2, bar.y2),
			distSeg(x, y, legL.x1, legL.y1, legL.x2, legL.y2),
			distSeg(x, y, legR.x1, legR.y1, legR.x2, legR.y2),
		);
		const glyph = dr <= stroke * 0.5;

		let r, g, bl, a;
		if (outside) {
			r = g = bl = a = 0;
		} else {
			// linear blend
			const t = Math.min(1, Math.max(0, (x + y) / (W + H)));
			r = c1[0] + (c2[0] - c1[0]) * t;
			g = c1[1] + (c2[1] - c1[1]) * t;
			bl = c1[2] + (c2[2] - c1[2]) * t;
			a = 255;
			if (glyph) { r = 255; g = 255; bl = 255; }
		}
		buf[i] = Math.round(r);
		buf[i + 1] = Math.round(g);
		buf[i + 2] = Math.round(bl);
		buf[i + 3] = Math.round(a);
	}
}

const outDir = path.resolve(__dirname, "../../build");
mkdirSync(outDir, { recursive: true });
const png = encodePNG(W, H, buf);
const outPath = path.join(outDir, "icon.png");
writeFileSync(outPath, png);
console.log("Wrote", outPath, png.length, "bytes");
