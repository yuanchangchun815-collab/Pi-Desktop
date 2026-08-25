// Generates build/icon.icns from build/icon.png (macOS: sips + iconutil).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, "../../build");
const iconset = path.join(buildDir, "icon.iconset");

mkdirSync(iconset, { recursive: true });
const png = path.join(buildDir, "icon.png");

for (const sz of [16, 32, 128, 256, 512]) {
	execFileSync("sips", ["-z", String(sz), String(sz), png, "--out", path.join(iconset, `icon_${sz}x${sz}.png`)], { stdio: "ignore" });
	const s2 = sz * 2;
	execFileSync("sips", ["-z", String(s2), String(s2), png, "--out", path.join(iconset, `icon_${sz}x${sz}@2x.png`)], { stdio: "ignore" });
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")], { stdio: "ignore" });
rmSync(iconset, { recursive: true, force: true });
console.log("Wrote", path.join(buildDir, "icon.icns"));
