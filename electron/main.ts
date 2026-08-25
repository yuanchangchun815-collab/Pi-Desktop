import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiService } from "./piService.js";
import { registerIpcHandlers } from "./ipc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | undefined;
let service: PiService | undefined;

// Default working directory for the agent. Can be overridden via env var.
const defaultCwd = process.env.PI_DESKTOP_CWD ?? process.cwd();

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		title: "Pi Desktop",
		backgroundColor: "#0f1117",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

	// Diagnostics: surface renderer console to the main log.
	mainWindow.webContents.on("console-message", (_e, _level, message) => {
		console.log("[renderer]", message);
	});
	mainWindow.webContents.on("did-finish-load", () => {
		console.log("[main] window did-finish-load");
	});
	mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
		console.error("[main] did-fail-load", code, desc);
	});

	mainWindow.on("closed", () => {
		mainWindow = undefined;
	});
}

async function startPi() {
	service = new PiService({
		cwd: defaultCwd,
		modelPattern: process.env.PI_DESKTOP_MODEL,
		thinkingLevel: process.env.PI_DESKTOP_THINKING,
	});
	if (!mainWindow) throw new Error("No window available");
	const win = mainWindow;
	registerIpcHandlers(
		win,
		service,
		{
			startNewSession: async () => {
				// Reset streaming state in UI after a new session.
				if (!win.isDestroyed()) {
					win.webContents.send("pi:session-info", {
						id: service!.sessionId,
						file: service!.sessionFile,
						cwd: defaultCwd,
					});
				}
			},
		},
		() => service?.cwd ?? defaultCwd,
	);
	await service.init();
}

app.whenReady().then(() => {
	createWindow();
	startPi().catch((err) => {
		console.error("Failed to start pi service:", err);
	});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", async () => {
	await service?.dispose();
});
