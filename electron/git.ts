import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const exec = promisify(execFile);

export interface GitStatusEntry {
	status: string; // 'M','A','D','R','U','??'...
	label: string; // human readable
	filePath: string; // repo-relative
}

export interface GitDiffResult {
	stdout: string;
	stats: { files: number; insertions: number; deletions: number };
}

/**
 * Runs git commands scoped to a repo. If `condaDir` is given, runs in that
 * directory; otherwise walks up from cwd. Returns null if not a git repo.
 */
export class Git {
	private cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
		try {
			const { stdout, stderr } = await exec("git", args, {
				cwd: this.cwd,
				maxBuffer: 20 * 1024 * 1024,
				encoding: "utf8",
			});
			return { stdout, stderr };
		} catch (err: any) {
			// git returns nonzero for empty results (e.g. no diff)
			const e = err as { stdout?: string; stderr?: string; message: string };
			return { stdout: e?.stdout ?? "", stderr: e?.stderr ?? e?.message ?? String(err) };
		}
	}

	/** True if cwd is inside a git repository. */
	async isRepo(): Promise<boolean> {
		const { stdout } = await this.run(["-C", this.cwd, "rev-parse", "--git-dir"]);
		return stdout.trim().length > 0;
	}

	/** Get the repo root absolute path. */
	async root(): Promise<string | null> {
		const { stdout } = await this.run(["-C", this.cwd, "rev-parse", "--show-toplevel"]);
		const r = stdout.trim();
		return r ? path.resolve(this.cwd, r) : null;
	}

	async currentBranch(): Promise<string> {
		const { stdout } = await this.run(["-C", this.cwd, "branch", "--show-current"]);
		return stdout.trim();
	}

	/** Short porcelain status list. */
	async status(): Promise<GitStatusEntry[]> {
		const { stdout } = await this.run(["-C", this.cwd, "status", "--porcelain=v1", "--untracked-files=all"]);
		const entries: GitStatusEntry[] = [];
		for (const line of stdout.split("\n")) {
			if (!line.trim()) continue;
			const code = line.slice(0, 2).trim();
			const filePath = line.slice(3);
			entries.push({ status: code, label: statusLabel(code), filePath });
		}
		return entries;
	}

	/** Diff of working tree vs HEAD (or vs index if staged). */
	async diff(filePath?: string): Promise<GitDiffResult> {
		const args = ["-C", this.cwd, "diff", "--color=never"];
		if (filePath) args.push("--", filePath);
		const { stdout } = await this.run(args);
		return { stdout, stats: parseDiffStats(stdout) };
	}

	/** Stream the full diff in chunks for large outputs. */
	async diffStream(filePath: string | undefined, signal?: { aborted: boolean }): Promise<{ stdout: string; stats: GitDiffResult["stats"] }> {
		return this.diff(filePath);
	}
}

function statusLabel(code: string): string {
	switch (code) {
		case "M": return "modified";
		case "A": return "added";
		case "D": return "deleted";
		case "R": return "renamed";
		case "U": return "conflict";
		case "??": return "untracked";
		case "MM": return "modified+staged";
		default: return code;
	}
}

function parseDiffStats(diff: string): { files: number; insertions: number; deletions: number } {
	const stats = { files: 0, insertions: 0, deletions: 0 };
	// lines like:  ... | 12 +++-----
	for (const line of diff.split("\n")) {
		const m = line.match(/^.*\|\s+(\d+)([\-+ ]*)$/);
		if (m && line.includes("|")) {
			stats.files++;
			const marks = m[2] ?? "";
			stats.insertions += (marks.match(/\+/g) ?? []).length;
			stats.deletions += (marks.match(/-/g) ?? []).length;
		}
	}
	if (stats.files === 0 && diff.trim()) stats.files = 1;
	return stats;
}
