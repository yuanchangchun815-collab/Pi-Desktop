import { test } from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	listDir,
	sanitizePath,
	resolveInsideRoot,
	writeTextFile,
	readFilePreview,
	makeDirectory,
	renameInside,
	deleteNode,
	searchFiles,
} from "../dist/electron/workspace.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp dir for the lifetime of a single test, auto-removed after. */
async function withTempRoot(fn) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desktop-test-"));
	try {
		await fn(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Path safety (the critical security surface)
// ---------------------------------------------------------------------------

test("sanitizePath: absolute path inside root resolves ok", () => {
	const root = path.resolve("/a/b");
	assert.equal(sanitizePath(root, "src/x.ts"), path.join(root, "src/x.ts"));
});

test("sanitizePath: resolves relative traversal that stays inside", () => {
	const root = path.resolve("/a/b");
	// ../../a/b uses parts that may escape b but land back inside a/b
	const got = sanitizePath(root, "x/../y");
	assert.equal(got, path.join(root, "y"));
});

test("sanitizePath: throws on escaping traversal (..)", () => {
	assert.throws(() => sanitizePath("/a/b", "../secret"), /escapes workspace root/);
});

test("sanitizePath: throws on absolute external path", () => {
	if (process.platform !== "win32") {
		assert.throws(() => sanitizePath("/a/b", "/etc/passwd"), /escapes workspace root/);
	}
});

test("sanitizePath: throws on nested .. wraparound", () => {
	assert.throws(() => sanitizePath("/a/b", "x/../../etc"), /escapes workspace root/);
});

test("resolveInsideRoot: root itself is allowed", async () => {
	const root = "/a/b";
	assert.equal(await resolveInsideRoot(root, "."), root);
});

test("resolveInsideRoot: same as sanitizePath, throws on escape", async () => {
	await assert.rejects(() => resolveInsideRoot("/a/b", "../etc"), /escapes workspace root/);
	if (process.platform !== "win32") {
		await assert.rejects(() => resolveInsideRoot("/a/b", "/etc"), /escapes workspace root/);
	}
});

// ---------------------------------------------------------------------------
// Functional file ops against a real temp dir
// ---------------------------------------------------------------------------

test("write/read preview round-trips UTF-8 text", async () => {
	await withTempRoot(async (root) => {
		await makeDirectory(root, "notes");
		await writeTextFile(root, "notes/hello.md", "你好 👋");
		const res = await readFilePreview(path.join(root, "notes/hello.md"));
		assert.equal(res.content, "你好 👋");
		assert.equal(res.truncated, false);
		assert.equal(res.encoding, "utf8");
	});
});

test("writeTextFile: rejects a path escaping root", async () => {
	await withTempRoot(async (root) => {
		await assert.rejects(() => writeTextFile(root, "../evil.txt", "x"), /escapes workspace root/);
		assert.equal(fs.existsSync(path.join(path.dirname(root), "evil.txt")), false);
	});
});

test("listDir: sorts dirs first, hides dotfiles by default", async () => {
	await withTempRoot(async (root) => {
		fs.writeFileSync(path.join(root, "b.txt"), "");
		fs.writeFileSync(path.join(root, "a.txt"), "");
		fs.mkdirSync(path.join(root, "zzz"));
		fs.mkdirSync(path.join(root, "aaa"));
		fs.writeFileSync(path.join(root, ".hidden"), "");

		const nodes = await listDir(root);
		const names = nodes.map((n) => n.name);
		assert.deepEqual(names, ["aaa", "zzz", "a.txt", "b.txt"]); // dirs first, alpha
		assert.ok(!names.includes(".hidden"));
	});
});

test("listDir: hidden:false includes dotfiles", async () => {
	await withTempRoot(async (root) => {
		fs.writeFileSync(path.join(root, ".env"), "");
		const nodes = await listDir(root, { hidden: false });
		assert.ok(nodes.some((n) => n.name === ".env"));
	});
});

test("makeDirectory + renameInside + deleteNode within root", async () => {
	await withTempRoot(async (root) => {
		await makeDirectory(root, "x/y");
		fs.writeFileSync(path.join(root, "x/y", "f.txt"), "data");

		await renameInside(root, "x", "z");
		assert.equal(fs.existsSync(path.join(root, "x")), false);
		assert.equal(fs.readFileSync(path.join(root, "z/y/f.txt"), "utf8"), "data");

		await deleteNode(root, "z/y/f.txt");
		assert.equal(fs.existsSync(path.join(root, "z/y/f.txt")), false);
		await deleteNode(root, "z/y");
		await deleteNode(root, "z");
	});
});

test("searchFiles: finds by substring, skips hidden", async () => {
	await withTempRoot(async (root) => {
		fs.writeFileSync(path.join(root, "myWidget.ts"), "");
		fs.mkdirSync(path.join(root, "widgets"));
		fs.writeFileSync(path.join(root, "widgets", "widgetUtil.ts"), "");
		fs.writeFileSync(path.join(root, ".widgetHidden.ts"), "");

		const res = await searchFiles(root, "widget");
		const names = res.map((r) => path.basename(r.path)).sort();
		assert.deepEqual(names, ["myWidget.ts", "widgets", "widgetUtil.ts"].sort());
		// hidden file excluded
		assert.ok(!names.includes(".widgetHidden.ts"));
	});
});

// ---------------------------------------------------------------------------
// Binary detection via readFilePreview
// ---------------------------------------------------------------------------

test("readFilePreview marks binary files as not previewable", async () => {
	await withTempRoot(async (root) => {
		const p = path.join(root, "blob.bin");
		fs.writeFileSync(p, Buffer.from([0xff, 0x00, 0x00, 0xff, 0xfe]));
		const res = await readFilePreview(p);
		assert.match(res.content, /二进制/);
		assert.equal(res.encoding, "binary");
	});
});
