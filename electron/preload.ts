import { contextBridge, ipcRenderer } from "electron";

/**
 * Exposed API available to the renderer via `window.pi`.
 */
const api = {
	init: () => ipcRenderer.invoke("pi:init"),
	prompt: (text: string, streamingBehavior?: "steer" | "followUp") =>
		ipcRenderer.invoke("pi:prompt", { text, streamingBehavior }),
	steer: (text: string) => ipcRenderer.invoke("pi:steer", text),
	followUp: (text: string) => ipcRenderer.invoke("pi:followUp", text),
	abort: () => ipcRenderer.invoke("pi:abort"),
	status: () => ipcRenderer.invoke("pi:status"),
	setThinking: (level: string) => ipcRenderer.invoke("pi:setThinking", level),
	listModels: () => ipcRenderer.invoke("pi:listModels"),
	setModel: (model: object) => ipcRenderer.invoke("pi:setModel", model),
	newSession: () => ipcRenderer.invoke("pi:newSession"),
	listSessions: () => ipcRenderer.invoke("pi:listSessions"),
	switchSession: (file: string) => ipcRenderer.invoke("pi:switchSession", file),

	// Workspace / files
	ws: {
		cwd: () => ipcRenderer.invoke("ws:cwd"),
		list: (dir: string) => ipcRenderer.invoke("ws:list", dir),
		read: (file: string) => ipcRenderer.invoke("ws:read", file),
		readBinary: (file: string) => ipcRenderer.invoke("ws:readBinary", file),
		docxText: (file: string) => ipcRenderer.invoke("ws:docxText", file),
		save: (file: string, content: string) => ipcRenderer.invoke("ws:save", { file, content }),
		create: (parent: string, name: string, type: "file" | "dir") =>
			ipcRenderer.invoke("ws:create", { parent, name, type }),
		delete: (target: string) => ipcRenderer.invoke("ws:delete", target),
		rename: (from: string, to: string) => ipcRenderer.invoke("ws:rename", { from, to }),
		search: (query: string) => ipcRenderer.invoke("ws:search", query),
		pickDir: () => ipcRenderer.invoke("ws:pickDir"),
		setCwd: (dir: string) => ipcRenderer.invoke("ws:setCwd", dir),
	},
	git: {
		info: () => ipcRenderer.invoke("git:info"),
		diff: (filePath?: string) => ipcRenderer.invoke("git:diff", filePath),
	},

	// Event subscriptions
	onEvent: (callback: (event: unknown) => void) => {
		const listener = (_e: unknown, event: unknown) => callback(event);
		ipcRenderer.on("pi:event", listener);
		return () => ipcRenderer.removeListener("pi:event", listener);
	},
	onSessionInfo: (callback: (info: unknown) => void) => {
		const listener = (_e: unknown, info: unknown) => callback(info);
		ipcRenderer.on("pi:session-info", listener);
		return () => ipcRenderer.removeListener("pi:session-info", listener);
	},
};

contextBridge.exposeInMainWorld("pi", api);

export type PiDesktopApi = typeof api;
