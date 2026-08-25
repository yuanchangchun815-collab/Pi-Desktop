import { ipcMain, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { PiService } from "./piService.js";
import {
	deleteNode,
	listDir,
	makeDirectory,
	readBinaryBase64,
	readDocxText,
	readFilePreview,
	renameInside,
	resolveInsideRoot,
	searchFiles,
	writeTextFile,
} from "./workspace.js";
import { Git } from "./git.js";

/**
 * Registers IPC handlers that let the renderer drive the PiService and
 * forwards SDK events back to the renderer.
 */
export function registerIpcHandlers(
	window: BrowserWindow,
	service: PiService,
	state: { startNewSession: () => Promise<void> },
	getCwd: () => string,
) {
	// Forward SDK events to the renderer.
	service.onEvent = (event) => {
		if (!window.isDestroyed()) {
			window.webContents.send("pi:event", event);
		}
	};

	service.onSessionReplaced = (info) => {
		if (!window.isDestroyed()) {
			window.webContents.send("pi:session-info", info);
		}
	};

	ipcMain.handle("pi:init", async () => {
		await service.init();
		return serviceStatus(service);
	});

	ipcMain.handle(
		"pi:prompt",
		async (_e, { text, streamingBehavior }: { text: string; streamingBehavior?: "steer" | "followUp" }) => {
			await service.prompt(text, streamingBehavior);
			return "ok";
		},
	);

	ipcMain.handle("pi:steer", async (_e, text: string) => {
		await service.steer(text);
		return "ok";
	});

	ipcMain.handle("pi:followUp", async (_e, text: string) => {
		await service.followUp(text);
		return "ok";
	});

	ipcMain.handle("pi:abort", async () => {
		await service.abort();
		return "ok";
	});

	ipcMain.handle("pi:status", () => serviceStatus(service));

	ipcMain.handle("pi:setThinking", (_e, level: string) => {
		service.setThinkingLevel(level as Parameters<PiService["setThinkingLevel"]>[0]);
		return serviceStatus(service);
	});

	ipcMain.handle("pi:listModels", async () => {
		try {
			return { ok: true, models: await service.listAvailableModels() };
		} catch (err: any) {
			return { ok: false, error: err?.message };
		}
	});

	ipcMain.handle("pi:setModel", async (_e, model: any) => {
		try {
			await service.setModel(model);
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err?.message };
		}
	});

	ipcMain.handle("pi:newSession", async () => {
		await service.newSession();
		await state.startNewSession?.();
		return serviceStatus(service);
	});

	ipcMain.handle("pi:listSessions", async () => {
		return service.getSessions();
	});

	ipcMain.handle("pi:switchSession", async (_e, file: string) => {
		await service.switchSession(file);
		return serviceStatus(service);
	});

	// ---- Workspace / files ----

	// Current working directory of the agent.
	const cwd = () => getCwd();

	ipcMain.handle("ws:cwd", () => ({ cwd: cwd() }));

	ipcMain.handle("ws:list", async (_e, dir: string) => {
		try {
			const safeDir = await resolveInsideRoot(cwd(), dir);
			const entries = await listDir(safeDir, { hidden: true, sort: true });
			return { ok: true, entries };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle("ws:read", async (_e, file: string) => {
		try {
			const safeFile = await resolveInsideRoot(cwd(), file);
			const res = await readFilePreview(safeFile);
			return { ok: true, ...res };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});

	// Read a file as base64 bytes (for PDF preview).
	ipcMain.handle("ws:readBinary", async (_e, file: string) => {
		try {
			const safeFile = await resolveInsideRoot(cwd(), file);
			return { ok: true, ...(await readBinaryBase64(safeFile)) };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});

	// Extract text from a .docx file (for Word preview).
	ipcMain.handle("ws:docxText", async (_e, file: string) => {
		try {
			const safeFile = await resolveInsideRoot(cwd(), file);
			const text = await readDocxText(safeFile);
			return { ok: true, text };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});

	// Write edited content back to a file inside the workspace.
	ipcMain.handle("ws:save", async (_e, { file, content }: { file: string; content: string }) => {
		try {
			await writeTextFile(cwd(), file, content);
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});

	// Create a new file or directory inside the workspace.
	ipcMain.handle(
		"ws:create",
		async (_e, { parent, name, type }: { parent: string; name: string; type: "file" | "dir" }) => {
			try {
				const safeParent = await resolveInsideRoot(cwd(), parent);
				const target = path.join(safeParent, name);
				if (type === "dir") {
					await makeDirectory(cwd(), target);
				} else {
					await fs.promises.writeFile(target, "", "utf8");
				}
				return { ok: true, path: target };
			} catch (err: any) {
				return { ok: false, error: err?.message ?? String(err) };
			}
		},
	);

	// Delete a file or empty directory inside the workspace.
	ipcMain.handle("ws:delete", async (_e, target: string) => {
		try {
			await deleteNode(cwd(), target);
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});

	// Rename a file or directory inside the workspace.
	ipcMain.handle("ws:rename", async (_e, { from, to }: { from: string; to: string }) => {
		try {
			await renameInside(cwd(), from, to);
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});

	// Search files within the workspace (for @ references and quick-open).
	ipcMain.handle("ws:search", async (_e, query: string) => {
		try {
			const results = await searchFiles(cwd(), query);
			return { ok: true, results };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});

	// ---- Git ----
	const git = () => new Git(cwd());

	ipcMain.handle("git:info", async () => {
		try {
			const g = git();
			if (!(await g.isRepo())) return { ok: true, isRepo: false };
			const [branch, root] = await Promise.all([g.currentBranch(), g.root()]);
			const status = await g.status();
			return { ok: true, isRepo: true, branch, root, status };
		} catch (err: any) {
			return { ok: false, error: err?.message };
		}
	});

	ipcMain.handle("git:diff", async (_e, filePath?: string) => {
		try {
			const result = await git().diff(filePath);
			return { ok: true, stdout: result.stdout, stats: result.stats };
		} catch (err: any) {
			return { ok: false, error: err?.message };
		}
	});

	// Open a native folder picker to change the working directory.
	ipcMain.handle("ws:pickDir", async () => {
		const result = await dialog.showOpenDialog(window, {
			title: "选择工作目录",
			properties: ["openDirectory"],
			defaultPath: cwd(),
		});
		if (result.canceled || result.filePaths.length === 0) return { canceled: true, path: null };
		return { canceled: false, path: result.filePaths[0] };
	});

	// Change the agent working directory to the given path.
	ipcMain.handle("ws:setCwd", async (_e, dir: string) => {
		try {
			const id = await service.setCwd(dir);
			if (!window.isDestroyed()) {
				window.webContents.send("pi:session-info", {
					id,
					file: service.sessionFile,
					cwd: dir,
				});
			}
			return { ok: true, cwd: dir };
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) };
		}
	});
}

function serviceStatus(service: PiService) {
	return {
		sessionId: service.sessionId,
		sessionFile: service.sessionFile,
		isStreaming: service.isStreaming,
	};
}
