import fs from "node:fs";
import path from "node:path";

const MAX_PREVIEW_BYTES = 256 * 1024; // 256 KB preview cap
const PEEK_LINES = 5000;

export interface FileNode {
	name: string;
	path: string;
	type: "dir" | "file";
	// dirs only, if listing a dir:
	children?: FileNode[];
}

/** Options for directory listing. */
export interface ListDirOptions {
	/** Skip dotfiles/dot-directories */
	hidden?: boolean;
	/** Sort dirs first then files, alphabetical. Default true. */
	sort?: boolean;
}

/** Enumerate the immediate children of a directory (not recursive). */
export async function listDir(dir: string, opts: ListDirOptions = {}): Promise<FileNode[]> {
	const hidden = opts.hidden ?? true;
	const sort = opts.sort ?? true;

	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const nodes: FileNode[] = [];
	for (const e of entries) {
		if (hidden && e.name.startsWith(".")) continue;
		let type: "dir" | "file" = "file";
		if (e.isDirectory()) type = "dir";
		else if (e.isSymbolicLink()) {
			// resolve symlinks to detect dir vs file
			try {
				const st = await fs.promises.stat(path.join(dir, e.name));
				type = st.isDirectory() ? "dir" : "file";
			} catch {
				type = "file";
			}
		}
		if (type === "dir") {
			nodes.push({ name: e.name, path: path.join(dir, e.name), type });
		} else if (e.isFile() || e.isSymbolicLink()) {
			nodes.push({ name: e.name, path: path.join(dir, e.name), type });
		}
	}
	if (sort) {
		nodes.sort((a, b) => {
			if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
		});
	}
	return nodes;
}

export interface ReadFileResult {
	content: string;
	truncated: boolean;
	bytes: number;
	encoding: string;
}

/** Read a text file for preview. Binary files return a placeholder. */
export async function readFilePreview(filePath: string): Promise<ReadFileResult> {
	const stat = await fs.promises.stat(filePath);
	let bytes = stat.size;
	if (stat.size > MAX_PREVIEW_BYTES) {
		bytes = MAX_PREVIEW_BYTES;
	}
	const fd = await fs.promises.open(filePath, "r");
	try {
		const buf = Buffer.alloc(bytes);
		await fd.read(buf, 0, bytes, 0);
		if (isBinary(buf)) {
			return {
				content: "[二进制文件，无法预览]",
				truncated: false,
				bytes: buf.length,
				encoding: "binary",
			};
		}
		return {
			content: buf.toString("utf8"),
			truncated: stat.size > MAX_PREVIEW_BYTES,
			bytes: stat.size,
			encoding: "utf8",
		};
	} finally {
		await fd.close();
	}
}

/** Read a file entirely as base64 bytes (for PDF/DOCX preview). Capped at 40MB. */
export async function readBinaryBase64(filePath: string): Promise<{ base64: string; mime: string; bytes: number; truncated: boolean }> {
	const MAX_BYTES = 40 * 1024 * 1024;
	const mime = mimeFromName(path.basename(filePath));
	const stat = await fs.promises.stat(filePath);
	if (stat.size > MAX_BYTES) {
		throw new Error("文件超过 40MB，无法预览");
	}
	const buf = await fs.promises.readFile(filePath);
	return {
		base64: buf.toString("base64"),
		mime,
		bytes: buf.length,
		truncated: false,
	};
}

function mimeFromName(name: string): string {
	const ext = path.extname(name).toLowerCase();
	switch (ext) {
		case ".pdf": return "application/pdf";
		case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
		case ".doc": return "application/msword";
		default: return "application/octet-stream";
	}
}

/**
 * Extract readable text/(light) HTML from a .docx file (a zip containing
 * word/document.xml). Returns plain text string. Throws if not a valid docx.
 */
export async function readDocxText(filePath: string): Promise<string> {
	const JSZip = (await import("jszip")).default;
	const buf = await fs.promises.readFile(filePath);
	const zip = await JSZip.loadAsync(buf);
	const names = Object.keys(zip.files);
	const docEntryName = names.find((n) => n === "word/document.xml" || n.endsWith("/word/document.xml"));
	if (!docEntryName) throw new Error("不是有效的 .docx 文档（缺少 word/document.xml）");
	const entry = zip.files[docEntryName];
	if (!entry) throw new Error("无法读取 word/document.xml");
	const xml = await entry.async("string");
	return docxXmlToPlainText(xml);
}

/** Minimal WordprocessingML → plain text/HTML conversion. */
function docxXmlToPlainText(xml: string): string {
	// Preserve paragraph breaks and basic emphasis, strip everything else.
	// First: replace block-level tags with newlines/markers.
	let s = xml;
	s = s.replace(/<w:p[^>]*>/g, "\n");
	s = s.replace(/<\/w:p>/g, "");
	s = s.replace(/<w:br[^>]*\/>/g, "\n");
	s = s.replace(/<w:tab[^>]*\/>/g, "\t");
	s = s.replace(/<w:tc[^>]*>/g, " | ");
	s = s.replace(/<w:tr[^>]*>/g, "\n");
	s = s.replace(/<w:tbl[^>]*>/g, "\n");

	// Extract text runs.
	const run = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
	const out: string[] = [];
	let m: RegExpExecArray | null;
	let last = 0;
	while ((m = run.exec(s)) !== null) {
		// anything between runs that isn't a tag path we keep as separators ignored
		const text = m[1]
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, "\"")
			.replace(/&#39;/g, "'")
			.replace(/_x000D_/g, "");
		out.push(text);
	}
	return out.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** Heuristic binary detection from the first chunk (NUL byte or non-text ratio). */function isBinary(buf: Buffer): boolean {
	if (buf.length === 0) return false;
	const sample = buf.subarray(0, Math.min(buf.length, 8192));
	// Common UTF-8 BOM is allowed
	let suspicious = 0;
	for (let i = 0; i < sample.length; i++) {
		if (sample[i] === 0) return true; // NUL byte -> binary
		if (sample[i] < 0x09 || (sample[i] > 0x0d && sample[i] < 0x20) && sample[i] !== 0x1b) {
			suspicious++;
			if (suspicious > 8) return true;
		} else {
			suspicious = 0;
		}
	}
	return false;
}

/** Return the resolved relative path for display purposes. */
export function sanitizePath(root: string, rel: string): string {
	const rootResolved = path.resolve(root);
	const target = path.resolve(rootResolved, rel);
	const relToRoot = path.relative(rootResolved, target);
	if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
		throw new Error("Path escapes workspace root");
	}
	return target;
}

/** Resolve a path and throw if it escapes `root`. Returns the absolute path. */
export async function resolveInsideRoot(root: string, target: string): Promise<string> {
	const rootResolved = path.resolve(root);
	const resolved = path.resolve(rootResolved, target);
	const relToRoot = path.relative(rootResolved, resolved);
	if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot) || relToRoot === "") {
		// allow === "" only if target resolves to the root itself
		if (relToRoot !== "") throw new Error("Path escapes workspace root");
	}
	return resolved;
}

/** Write UTF-8 text to a file inside `root`. Overwrites existing files. */
export async function writeTextFile(root: string, filePath: string, content: string): Promise<void> {
	const resolved = await resolveInsideRoot(root, filePath);
	await fs.promises.writeFile(resolved, content, "utf8");
}

/** Create a directory (and parents) inside `root`. */
export async function makeDirectory(root: string, dirPath: string): Promise<void> {
	const resolved = await resolveInsideRoot(root, dirPath);
	await fs.promises.mkdir(resolved, { recursive: true });
}

/** Delete a file or empty dir inside `root`. */
export async function deleteNode(root: string, targetPath: string): Promise<void> {
	const resolved = await resolveInsideRoot(root, targetPath);
	const st = await fs.promises.stat(resolved);
	if (st.isDirectory()) {
		await fs.promises.rmdir(resolved); // only empty dirs
	} else {
		await fs.promises.unlink(resolved);
	}
}

/** Rename a file or dir inside `root`. */
export async function renameInside(root: string, from: string, to: string): Promise<void> {
	const src = await resolveInsideRoot(root, from);
	const dst = await resolveInsideRoot(root, to);
	await fs.promises.rename(src, dst);
}

/**
 * Recursively search for files/dirs whose name contains `query` under `root`.
 * Limited by maxResults and max depth to stay responsive on large repos.
 */
export async function searchFiles(
	root: string,
	query: string,
	maxResults = 50,
	maxDepth = 6,
): Promise<Array<{ name: string; path: string; type: "dir" | "file" }>> {
	const q = query.toLowerCase();
	const results: Array<{ name: string; path: string; type: "dir" | "file" }> = [];
	let stopped = false;

	async function walk(dir: string, depth: number) {
		if (stopped || depth > maxDepth) return;
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (stopped) return;
			if (e.name.startsWith(".")) continue; // skip hidden
			const full = path.join(dir, e.name);
			const isDir = e.isDirectory();
			if (isDir || e.isFile()) {
				if (e.name.toLowerCase().includes(q)) {
					results.push({ name: e.name, path: full, type: isDir ? "dir" : "file" });
					if (results.length >= maxResults) {
						stopped = true;
						return;
					}
				}
			}
			if (isDir) await walk(full, depth + 1);
		}
	}

	await walk(root, 0);
	return results;
}
