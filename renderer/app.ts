import type { PiDesktopApi } from "../electron/preload.js";
import { FileEditor } from "./editor.js";
import { MentionAutocomplete } from "./mention.js";
import { renderMarkdown } from "./mdPreview.js";

declare global {
	interface Window {
		pi: PiDesktopApi;
	}
}

// ---- DOM references ----
const messagesEl = document.getElementById("messages") as HTMLDivElement;
const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const abortBtn = document.getElementById("abort-btn") as HTMLButtonElement;
const statusBar = document.getElementById("status-bar") as HTMLDivElement;
const sessionBadge = document.getElementById("session-badge") as HTMLDivElement;
const thinkingSelect = document.getElementById("thinking-select") as HTMLSelectElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const sessionsPanel = document.getElementById("sessions-panel") as HTMLDivElement;
const sessionsList = document.getElementById("sessions-list") as HTMLUListElement;
const sessionsBtn = document.getElementById("sessions-btn") as HTMLButtonElement;
const newBtn = document.getElementById("new-btn") as HTMLButtonElement;

// Git panel DOM
const gitBtn = document.getElementById("git-btn") as HTMLButtonElement;
const gitPanel = document.getElementById("git-panel") as HTMLDivElement;
const gitBranch = document.getElementById("git-branch") as HTMLSpanElement;
const gitStatusEl = document.getElementById("git-status") as HTMLDivElement;
const gitRefresh = document.getElementById("git-refresh") as HTMLButtonElement;
const gitClose = document.getElementById("git-close") as HTMLButtonElement;
const gitDiffWrap = document.getElementById("git-diff-wrap") as HTMLDivElement;
const gitDiffFile = document.getElementById("git-diff-file") as HTMLSpanElement;
const gitDiffEl = document.getElementById("git-diff") as HTMLPreElement;
const gitDiffClose = document.getElementById("git-diff-close") as HTMLButtonElement;

// Workspace / files DOM
const changeDirBtn = document.getElementById("change-dir-btn") as HTMLButtonElement;
const addFileBtn = document.getElementById("add-file-btn") as HTMLButtonElement;
const cwdLabel = document.getElementById("cwd-label") as HTMLDivElement;
const cwdPill = document.getElementById("cwd-pill") as HTMLSpanElement;
const fileTree = document.getElementById("file-tree") as HTMLDivElement;
const editorPanel = document.getElementById("editor-panel") as HTMLElement;
const editorTitle = document.getElementById("editor-title") as HTMLSpanElement;
const editorMeta = document.getElementById("editor-meta") as HTMLDivElement;
const cmContainer = document.getElementById("cm-editor") as HTMLDivElement;
const editorStatus = document.getElementById("editor-status") as HTMLDivElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const closeEditorBtn = document.getElementById("close-editor-btn") as HTMLButtonElement;
const wrapToggle = document.getElementById("wrap-toggle") as HTMLInputElement;
const previewToggle = document.getElementById("preview-toggle") as HTMLInputElement;
const previewPane = document.getElementById("preview-pane") as HTMLDivElement;
const previewContentEl = document.getElementById("preview-content") as HTMLDivElement;
const previewFrame = document.getElementById("preview-frame") as HTMLIFrameElement;
const editorBodies = document.getElementById("editor-bodies") as HTMLDivElement;

// Workspace / files state
let currentCwd = "";
const expandedDirs = new Set<string>();
let editor: {
	path: string;
	original: string;
	dirty: boolean;
} | undefined;
let originalContent = "";
// "md" | "html" | "pdf" | "docx" | "none" — controls which preview renderer runs
let previewKind: "md" | "html" | "pdf" | "docx" | "none" = "none";
const modelOptions = new Map<string, object>();

// CodeMirror-based file editor instance.
let fileEditor: FileEditor;

// ---- Streaming state ----
interface ActiveMessage {
	el: HTMLDivElement;
	textEl: HTMLDivElement;
	thinkingEl?: HTMLDivElement;
	buffer: string;
	thinkingBuffer: string;
	toolCalls: Map<string, { el: HTMLDivElement; bodyEl: HTMLDivElement; stream: string; complete: boolean }>;
}

let active: ActiveMessage | undefined;
let busy = false;
let sessionInfo: any;
let thinkingLevel = "medium";

init();

// ---- Boot ----
async function init() {
	setStatus("正在启动 pi SDK…", "busy");
	try {
		const status = await window.pi.init();
		updateSessionBadge(status);
		setStatus("就绪。选择工作目录后即可对话。");
		thinkingSelect.value = "medium";
	} catch (err: any) {
		setStatus(`初始化失败: ${err?.message ?? String(err)}`, "error");
		console.error(err);
	}
	await initWorkspace();
	await loadModels();
	wireEvents();
}

function wireEvents() {
	window.pi.onEvent((rawEvent) => {
		try {
			handleEvent(rawEvent);
		} catch (e) {
			console.error("event handler error:", e);
		}
	});
	window.pi.onSessionInfo((info: any) => {
		sessionInfo = info;
		updateSessionBadge(info);
	});
	sendBtn.addEventListener("click", onSend);
	abortBtn.addEventListener("click", onAbort);
	inputEl.addEventListener("keydown", (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			onSend();
		}
	});
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape") onAbort();
	});
	thinkingSelect.addEventListener("change", async () => {
		thinkingLevel = thinkingSelect.value;
		await window.pi.setThinking(thinkingLevel);
	});
	modelSelect.addEventListener("change", async () => {
		const id = modelSelect.value;
		if (!id) return;
		const models = modelOptions.get(id);
		if (models) {
			await window.pi.setModel(models);
			setStatus(`已切换模型: ${(models as any).id ?? id}`, "");
		}
	});
	newBtn.addEventListener("click", async () => {
		await window.pi.newSession();
		messagesEl.innerHTML = "";
		active = undefined;
		setStatus("新会话已创建。", "");
	});
	sessionsBtn.addEventListener("click", toggleSessions);

	// Git panel
	gitBtn.addEventListener("click", () => {
		if (gitPanel.hidden) {
			gitPanel.hidden = false;
			loadGit();
		} else {
			gitPanel.hidden = true;
		}
	});
	gitRefresh.addEventListener("click", loadGit);
	gitClose.addEventListener("click", () => { gitPanel.hidden = true; });
	gitDiffClose.addEventListener("click", () => { gitDiffWrap.hidden = true; });

	// Workspace / files events
	changeDirBtn.addEventListener("click", onChangeDir);
	addFileBtn.addEventListener("click", onCreateNode);
	saveBtn.addEventListener("click", onSave);
	closeEditorBtn.addEventListener("click", () => closeEditor());
	fileEditor = new FileEditor(cmContainer);
	fileEditor.onChange = onEditorInput;

	// Markdown / preview toggle. Preview shown when file is Markdown-ish.
	previewToggle.addEventListener("change", onPreviewToggle);

	// Wrap toggle: no-wrap by default (editor + preview scroll horizontally).
	wrapToggle.checked = false; // no wrap
	applyWrap(false);
	wrapToggle.addEventListener("change", () => applyWrap(wrapToggle.checked));

	// Panel drag-resizing between sidebar / main / editor.
	setupResizers();

	// @ file autocomplete in the chat input.
	const mentionContainer = document.getElementById("editor") as HTMLElement;
	new MentionAutocomplete({
		input: inputEl,
		container: mentionContainer,
		search: (q) => window.pi.ws.search(q).then((r) => (r.ok ? r.results : [])),
		onInsert: () => {},
	});

	// Drag a file into the chat input to insert an @path reference.
	let lastDragTarget: EventTarget | null = null;
	inputEl.addEventListener("dragover", (e) => {
		e.preventDefault();
		e.dataTransfer!.dropEffect = "copy";
		inputEl.classList.add("drag-over");
		lastDragTarget = e.target;
	});
	inputEl.addEventListener("dragleave", (e) => {
		if (lastDragTarget === e.target) {
			inputEl.classList.remove("drag-over");
		}
	});
	inputEl.addEventListener("drop", async (e) => {
		e.preventDefault();
		inputEl.classList.remove("drag-over");
		const files = Array.from(e.dataTransfer?.files ?? []);
		if (files.length) {
			// OS file drop
			const paths = files.map((f) => (f as any).path || f.name);
			appendRefs(paths);
			return;
		}
		const p = e.dataTransfer?.getData("application/x-file-path")
			|| e.dataTransfer?.getData("text/plain");
		if (p) appendRefs([p]);
	});
	window.addEventListener("keydown", (e) => {
		if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
			e.preventDefault();
			if (!editorPanel.hidden) onSave();
		}
	});
	sessionBadge.addEventListener("click", () => {
		navigator.clipboard.writeText(sessionInfo?.sessionId ?? "");
		setStatus("session ID 已复制", "");
	});

	thinkingSelect.value = thinkingLevel;

	// Enable the send button after startup (it starts disabled from HTML).
	setBusy(false);
	updateSendButtonForInput();
	inputEl.addEventListener("input", updateSendButtonForInput);
}

// ---- Send / abort ----
async function onSend() {
	const text = inputEl.value.trim();
	if (!text || busy) return;
	inputEl.value = "";
	addMessage("user", text);
	addMessage("assistant", "");
	setBusy(true);
	try {
		await window.pi.prompt(text);
	} catch (err: any) {
		pushAssistantError(err);
	} finally {
		setBusy(false);
	}
	finishActive();
}

async function onAbort() {
	if (!busy) return;
	await window.pi.abort();
	pushStatus("已中止当前任务");
	setBusy(false);
	finishActive();
}

// ---- Event handling ----
function handleEvent(ev: any) {
	if (!ev || typeof ev.type !== "string") return;

	switch (ev.type) {
		case "agent_start":
			setBusy(true);
			break;
		case "agent_end":
			setBusy(false);
			finishActive();
			break;
		case "agent_settled":
			setBusy(false);
			finishActive();
			break;

		case "message_start":
			beginMessage();
			break;
		case "message_update": {
			const u = ev.assistantMessageEvent;
			if (!u) break;
			ensureMessage();
			if (u.type === "text_delta") appendText(u.delta);
			else if (u.type === "thinking_delta") appendThinking(u.delta);
			break;
		}

		case "tool_execution_start":
			ensureMessage();
			beginTool(ev.toolName, ev.toolCallId, ev.args);
			break;
		case "tool_execution_update": {
			const b = active?.toolCalls.get(ev.toolCallId);
			if (b) {
				b.stream += stringifyPartial(ev.partialResult);
				b.bodyEl.textContent = b.stream;
				scroll(b.el);
			}
			break;
		}
		case "tool_execution_end": {
			const b = active?.toolCalls.get(ev.toolCallId);
			if (b) {
				b.stream = toolResultText(ev.result);
				b.complete = true;
				b.bodyEl.textContent = b.stream || (ev.isError ? "(执行出错，无输出)" : "(无输出)");
				setToolStatus(b.el, ev.isError ? "✗ error" : "✓ done");
			}
			break;
		}

		case "turn_end":
			finishActive();
			break;

		// Session / compaction events
		case "queue_update":
			pushStatus(`排队中: steering ${ev.steering?.length ?? 0}, follow-up ${ev.followUp?.length ?? 0}`);
			break;
		case "compaction_start":
			pushStatus("正在压缩上下文…");
			break;
		case "compaction_end":
			pushStatus("上下文压缩完成");
			break;

		case "error":
			pushAssistantError(ev);
			break;
	}
}

// ---- Message rendering helpers ----
// A message is rendered lazily: beginMessage only books a slot (no DOM);
// ensureMessage materializes the bubble on the first real content. This avoids
// the empty bubbles caused by tool_result message_start events.
let msgReady = false;

function beginMessage() {
	if (active) return; // keep streaming into the current assistant message
	active = {
		el: document.createElement("div"),
		textEl: document.createElement("div"),
		buffer: "",
		thinkingBuffer: "",
		toolCalls: new Map(),
	};
	msgReady = false;
}

/** Create the DOM for the current message if not yet materialized and there is content. */
function ensureMessage() {
	if (!active) beginMessage();
	if (msgReady || !active) return;
	active.el!.className = "msg assistant";
	const header = document.createElement("div");
	header.className = "msg-header";
	header.textContent = "pi";
	active.el!.appendChild(header);
	active.textEl.className = "bubble";
	active.el!.appendChild(active.textEl);
	messagesEl.appendChild(active.el!);
	msgReady = true;
}

function addMessage(role: "user" | "assistant", text: string, error = false) {
	const wrap = document.createElement("div");
	wrap.className = `msg ${role}${error ? " error" : ""}`;
	const header = document.createElement("div");
	header.className = "msg-header";
	header.textContent = role === "user" ? "你" : "pi";
	const bubble = document.createElement("div");
	bubble.className = "bubble";
	bubble.textContent = text;
	wrap.appendChild(header);
	wrap.appendChild(bubble);
	messagesEl.appendChild(wrap);
	active = {
		el: wrap,
		textEl: bubble,
		buffer: text,
		thinkingBuffer: "",
		toolCalls: new Map(),
	};
	msgReady = true;
	scroll(wrap);
}

function appendText(delta: string) {
	if (!active) beginMessage();
	ensureMessage();
	active!.buffer += delta;
	active!.textEl.textContent = active!.buffer;
	scroll(active!.el!);
}

function appendThinking(delta: string) {
	if (!active) beginMessage();
	ensureMessage();
	if (!active!.thinkingEl) {
		active!.thinkingEl = document.createElement("div");
		active!.thinkingEl.className = "thinking";
		const label = document.createElement("span");
		label.textContent = "思考";
		active!.thinkingEl!.appendChild(label);
		const pre = document.createElement("div");
		active!.thinkingEl!.appendChild(pre);
		active!.el!.insertBefore(active!.thinkingEl, active!.textEl);
	}
	active!.thinkingBuffer += delta;
	const pre = active!.thinkingEl!.querySelector("div")!;
	pre.textContent = active!.thinkingBuffer;
	scroll(active!.el!);
}

function beginTool(name: string, id: string, args: any) {
	if (!active) beginMessage();
	ensureMessage();
	const wrap = document.createElement("div");
	wrap.className = "tool";
	wrap.dataset.id = id;
	const argSummary = summarizeArgs(name, args);
	const head = document.createElement("div");
	head.className = "tool-head";
	head.innerHTML = `<span class="tool-name">${escapeHtml(name)}</span>` +
		(argSummary ? `<span class="tool-args">${escapeHtml(argSummary)}</span>` : "") +
		`<span class="status">运行中…</span>`;
	const body = document.createElement("div");
	body.className = "tool-body";
	// Keep the tool output visible by default so edits/diffs are not hidden.
	body.style.display = "block";
	head.addEventListener("click", () => {
		body.style.display = body.style.display === "none" ? "block" : "none";
	});
	wrap.appendChild(head);
	wrap.appendChild(body);
	active!.el!.insertBefore(wrap, active!.textEl);
	active!.toolCalls.set(id, { el: wrap, bodyEl: body, stream: "", complete: false });
	setToolStatus(wrap, "运行中…");
	scroll(wrap);
}

function setToolStatus(el: HTMLDivElement, text: string) {
	const s = el.querySelector(".status") as HTMLSpanElement;
	if (s) s.textContent = text;
}

function finishActive() {
	active = undefined;
	msgReady = false;
}

function pushAssistantError(err: any) {
	const msg = err?.message ?? (err ? String(err) : "未知错误");
	addMessage("assistant", msg, true);
	active = undefined;
}

function pushStatus(text: string) {
	const wrap = document.createElement("div");
	wrap.className = "msg assistant";
	const bubble = document.createElement("div");
	bubble.className = "tool";
	bubble.textContent = "ℹ " + text;
	wrap.appendChild(bubble);
	messagesEl.appendChild(wrap);
	scroll(wrap);
}

function setBusy(b: boolean) {
	busy = b;
	updateSendButton();
	abortBtn.hidden = !b;
	statusBar.classList.toggle("busy", b);
	statusBarChip(b ? `<span class="dot busy"></span>处理中…` : `就绪`);
}

/** Button is enabled whenever we're not busy (empty-input guard is in onSend). */
function updateSendButton() {
	sendBtn.disabled = busy;
}

/** Called on every input change to reflect whether sending is possible. */
function updateSendButtonForInput() {
	updateSendButton();
}

function setStatus(text: string, cls = "") {
	statusBar.className = "";
	if (cls) statusBar.classList.add(cls);
	statusBar.innerHTML = `<span class="dot"></span>${escapeHtml(text)}`;
}

function statusBarChip(html: string) {
	statusBar.innerHTML = `<span class="dot busy"></span>${html}`;
}

function updateSessionBadge(info: any) {
	sessionBadge.textContent = info?.sessionId ? `session: ${info.sessionId.slice(0, 12)}` : "—";
}

function escapeHtml(s: string) {
	return s.replace(/[&<>"']/g, (c) =>
		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
	);
}

/** Short human-readable summary of a tool call's arguments (e.g. edit target). */
function summarizeArgs(name: string, args: any): string {
	if (!args || typeof args !== "object") return "";
	try {
		switch (name) {
			case "edit":
			case "write":
			case "read": {
				const p = (args as any).path ?? (args as any).file_path ?? (args as any).file;
				if (p) return "→ " + String(p);
				break;
			}
			case "bash": {
				const cmd = (args as any).command ?? (args as any).cmd;
				if (cmd) return "$ " + String(cmd).slice(0, 60);
				break;
			}
			default: break;
		}
	} catch {}
	return "";
}

/** Tool streaming partial results are text chunks or objects; flatten to text. */
function stringifyPartial(partial: any): string {
	if (typeof partial === "string") return partial;
	if (typeof partial === "number" || typeof partial === "boolean") return String(partial);
	if (!partial) return "";
	if (typeof partial === "object") {
		// bash/read stream { content: [{ type: "text", text }], details }
		const content = Array.isArray(partial.content) ? partial.content : null;
		if (content) {
			const parts: string[] = [];
			for (const c of content) {
				if (c && typeof c.text === "string") parts.push(c.text);
			}
			if (parts.length) return parts.join("\n");
		}
		const out = (partial as any).output ?? (partial as any).text;
		if (typeof out === "string") return out;
	}
	try { return JSON.stringify(partial); } catch { return ""; }
}

/** Extract displayable text from a ToolResult object on tool_execution_end. */
function toolResultText(result: any): string {
	if (!result) return "";
	if (typeof result === "string") return result;
	// ToolResult shape: { content: [{ type: "text", text }], details }
	const content = Array.isArray(result.content) ? result.content : result.content?.content;
	const parts: string[] = [];
	if (Array.isArray(content)) {
		for (const c of content) {
			if (c && typeof c === "object") {
				if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
				else if (typeof c.text === "string") parts.push(c.text);
			}
		}
	}
	// Include the raw diff/details for edit/bash so the user can see what changed.
	const details = result.details;
	if (details && typeof details === "object") {
		const diff = (details as any).diff;
		const patch = (details as any).patch;
		if (typeof diff === "string" && diff) parts.push("\n[修改内容 diff]\n" + diff);
		else if (typeof patch === "string" && patch) parts.push("\n[补丁 patch]\n" + patch);
		else {
			const rest = Object.fromEntries(Object.entries(details as any).filter(([k]) => k !== "diff" && k !== "patch"));
			if (Object.keys(rest).length) parts.push("\n" + JSON.stringify(rest, null, 2));
		}
	}
	if (parts.length) return parts.join("\n");
	if (details && typeof details === "object") {
		try { return JSON.stringify(details, null, 2); } catch {}
	}
	try { return JSON.stringify(result, null, 2); } catch { return ""; }
}

function scroll(el: Element) {
	// Only auto-scroll the container if the user is near the bottom already.
	const cont = messagesEl;
	const nearBottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 160;
	if (el) {
		const r = el.getBoundingClientRect();
		if (r.bottom > window.innerHeight - 120) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
	} else if (nearBottom) {
		cont.scrollTo({ top: cont.scrollHeight, behavior: "smooth" });
	}
}

// ---- Sessions panel ----
async function toggleSessions() {
	if (sessionsPanel.hidden) {
		const list = await window.pi.listSessions();
		sessionsList.innerHTML = "";
		for (const item of (list as any[])) {
			const li = document.createElement("li");
			const file = document.createElement("span");
			file.className = "sess-file";
			file.textContent = item.file ?? "";
			li.appendChild(file);
			li.appendChild(document.createTextNode(item.startedAt ?? ""));
			li.addEventListener("click", () => {
				window.pi.switchSession(item.file);
				sessionsPanel.hidden = true;
			});
			sessionsList.appendChild(li);
		}
		sessionsPanel.hidden = false;
	} else {
		sessionsPanel.hidden = true;
	}
}

// =====================================================================
// Workspace / file tree
// =====================================================================

async function loadModels() {
	const res = await window.pi.listModels();
	if (!res.ok) return;
	const models: any[] = res.models ?? [];
	modelSelect.innerHTML = '<option value="">模型…</option>';
	modelOptions.clear();
	for (const m of models) {
		const id = m.id ?? `${m.provider ?? ""}/${m.name ?? ""}`;
		if (!id) continue;
		modelOptions.set(id, m);
		const opt = document.createElement("option");
		opt.value = id;
		opt.textContent = m.label ?? m.name ?? id;
		modelSelect.appendChild(opt);
	}
	modelSelect.style.display = models.length ? "" : "none";
}

async function initWorkspace() {
	try {
		const { cwd } = await window.pi.ws.cwd();
		currentCwd = cwd;
		cwdLabel.textContent = cwd;
		cwdPill.textContent = cwd;
		await loadDirectory(cwd, fileTree, false);
	} catch (err: any) {
		console.error("workspace init failed:", err);
		setStatus(`文件浏览初始化失败: ${err?.message ?? err}`, "error");
	}
}

/** Load a directory's children into a container, recursively expanding dirs already in expandedDirs. */
async function loadDirectory(dir: string, container: HTMLDivElement, isRoot = true) {
	container.innerHTML = "";
	const res = await window.pi.ws.list(dir);
	if (!res.ok) {
		const empty = document.createElement("div");
		empty.className = "tree-empty";
		empty.textContent = `无法读取: ${res.error}`;
		container.appendChild(empty);
		return;
	}
	if (isRoot && res.entries.length === 0) {
		const empty = document.createElement("div");
		empty.className = "tree-empty";
		empty.textContent = "（空目录）";
		container.appendChild(empty);
		return;
	}
	for (const entry of res.entries) {
		container.appendChild(await renderNode(dir, entry));
	}
}

async function renderNode(parentDir: string, entry: any): Promise<HTMLDivElement> {
	const node = document.createElement("div");
	node.className = "tree-node";
	node.dataset.path = entry.path;

	const row = document.createElement("div");
	row.className = "tree-row";
	row.title = entry.path;

	const twist = document.createElement("span");
	twist.className = "twist";
	const icon = document.createElement("span");
	icon.className = "icon";
	const name = document.createElement("span");
	name.className = "name";
	name.textContent = entry.name;

	// Async loader for a directory's children (reused for expand & initial load).
	const loadChildren = async (wrap: HTMLDivElement) => {
		wrap.innerHTML = "";
		const res = await window.pi.ws.list(entry.path);
		if (res.ok) {
			if (res.entries.length === 0) {
				const empty = document.createElement("div");
				empty.className = "tree-empty";
				empty.textContent = "（空）";
				wrap.appendChild(empty);
				return;
			}
			for (const c of res.entries) {
				wrap.appendChild(await renderNode(entry.path, c));
			}
		} else {
			const empty = document.createElement("div");
			empty.className = "tree-empty";
			empty.textContent = res.error;
			wrap.appendChild(empty);
		}
	};

	if (entry.type === "dir") {
		twist.textContent = expandedDirs.has(entry.path) ? "▼" : "▶";
		icon.textContent = "📁";
		node.appendChild(row);
		const childrenWrap = document.createElement("div");
		childrenWrap.className = "tree-children";
		node.appendChild(childrenWrap);
		// If already expanded, load children now.
		if (expandedDirs.has(entry.path)) {
			await loadChildren(childrenWrap);
		}
		row.addEventListener("click", async (e) => {
			e.stopPropagation();
			const willExpand = !expandedDirs.has(entry.path);
			if (willExpand) {
				expandedDirs.add(entry.path);
				twist.textContent = "▼";
				if (childrenWrap.children.length === 0) {
					await loadChildren(childrenWrap);
				}
			} else {
				expandedDirs.delete(entry.path);
				twist.textContent = "▶";
				childrenWrap.innerHTML = "";
			}
		});
	} else {
		twist.textContent = "";
		icon.textContent = fileIconFor(entry.name);
		node.appendChild(row);
		// Make file rows draggable so they can be dropped into the chat input.
		row.draggable = true;
		row.addEventListener("dragstart", (e) => {
			e.dataTransfer?.setData("text/plain", entry.path);
			e.dataTransfer?.setData("application/x-file-path", entry.path);
			e.dataTransfer!.effectAllowed = "copy";
		});
		// Click to open in editor.
		row.addEventListener("click", (e) => {
			e.stopPropagation();
			selectTreeNode(row);
			openFile(entry.path);
		});
		// Right-click context menu: copy path / rename / delete
		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			fileMenu(entry);
		});
	}

	row.appendChild(twist);
	row.appendChild(icon);
	row.appendChild(name);
	return node;
}

function selectTreeNode(row: HTMLDivElement) {
	fileTree.querySelectorAll(".tree-row.selected").forEach((r) => r.classList.remove("selected"));
	row.classList.add("selected");
}

async function rehydrateTree() {
	await loadDirectory(currentCwd, fileTree, false);
}

function fileIconFor(name: string): string {
	if (/\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(name)) return "🟨";
	if (/\.(css|scss|html)$/i.test(name)) return "🟧";
	if (/\.(json|ya?ml|toml)$/i.test(name)) return "📄";
	if (/\.(md|txt)$/i.test(name)) return "📝";
	if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(name)) return "🖼";
	if (/^Dockerfile$/.test(name)) return "🐳";
	if (/package(-lock)?\.json$/.test(name)) return "📦";
	return "📄";
}

// ---- Persistent file editor ----

async function openFile(file: string) {
	// Warn before discarding unsaved edits in the current file.
	if (editor?.dirty && editor.path !== file) {
		const keep = confirm("当前文件有未保存的修改，打开其他文件前要保存吗？\n“确定”=丢弃修改，打开新文件；“取消”=留在当前文件。");
		if (!keep) return;
	}
	const res = await window.pi.ws.read(file);
	if (!res.ok) {
		editorStatus.textContent = `读取失败: ${res.error}`;
		editorStatus.className = "error";
		return;
	}
	if (res.encoding === "binary") {
		// Binary file. If it's a previewable binary (PDF/DOCX/DOc), show preview.
		const kind = previewKindOf(file);
		editorPanel.hidden = false;
		editorTitle.textContent = basename(file);
		editorMeta.textContent = file;
		saveBtn.disabled = true;
		if (kind === "pdf" || kind === "docx") {
			// Not editable in CM; hide the code editor entirely.
			fileEditor.enable(false);
			fileEditor.setContent("", basename(file));
			cmContainer.style.display = "none";
			editorStatus.textContent = `${basename(file)}（预览模式，不可编辑）`;
			editorStatus.className = "";
			editor = undefined;
			originalContent = "";
			await renderPreviewFor(file);
		} else {
			fileEditor.enable(false);
			fileEditor.setContent(res.content, basename(file));
			editorStatus.textContent = "二进制文件，不可预览";
			editorStatus.className = "";
			previewKind = "none";
			setEditorPreviewable(false);
		}
		return;
	}
	let content = res.content;
	editorPanel.hidden = false;
	editorTitle.textContent = basename(file);
	editorMeta.textContent = `${file} · ${(res.bytes / 1024).toFixed(1)} KB · UTF-8`;
	fileEditor.enable(true);
	fileEditor.setContent(content, basename(file));
	cmContainer.style.display = "";
	if (res.truncated) {
		editorStatus.textContent = `⚠ 文件超过 ${(res.bytes / 1024).toFixed(0)} KB，仅加载前 256 KB（保存会覆盖全文）`;
		editorStatus.className = "error";
	} else {
		editorStatus.textContent = "就绪（修改后保存）";
		editorStatus.className = "";
	}
	editor = { path: file, original: content, dirty: false };
	originalContent = content;
	saveBtn.disabled = true;
	await renderPreviewFor(file);
	fileEditor.scrollToTop();
	fileEditor.focus();
}

function onEditorInput() {
	if (!editor) {
		saveBtn.disabled = true;
		return;
	}
	editor.dirty = fileEditor.getContent() !== editor.original;
	saveBtn.disabled = !editor.dirty;
	if (editor.dirty) {
		editorStatus.textContent = "● 未保存的修改";
		editorStatus.className = "dirty";
	} else {
		editorStatus.textContent = "已保存";
		editorStatus.className = "saved";
	}
	updatePreview();
}

async function onSave() {
	if (!editor || !editor.dirty) return;
	const content = fileEditor.getContent();
	const res = await window.pi.ws.save(editor.path, content);
	if (res.ok) {
		editor.dirty = false;
		editor.original = content;
		originalContent = content;
		saveBtn.disabled = true;
		editorStatus.textContent = "✅ 已保存";
		editorStatus.className = "saved";
		setStatus("文件已保存", "");
	} else {
		editorStatus.textContent = `保存失败: ${res.error}`;
		editorStatus.className = "error";
	}
}

function closeEditor() {
	// If there are unsaved changes, hide anyway (user can reopen).
	editorPanel.hidden = true;
	editor = undefined;
	previewKind = "none";
	fileEditor.setContent("", "");
	fileEditor.enable(false);
	saveBtn.disabled = true;
	previewFrame.src = "";
	previewFrame.srcdoc = "";
	previewFrame.hidden = true;
	previewContentEl.innerHTML = "";
	previewContentEl.hidden = false;
	cmContainer.style.display = "";
	setEditorPreviewable(false);
}

function basename(p: string) {
	const parts = p.split(/[\\/]/);
	return parts[parts.length - 1] || p;
}

// ---- Change working directory ----
async function onChangeDir() {
	const res = await window.pi.ws.pickDir();
	if (res.canceled || !res.path) return;
	// Update the agent's working directory.
	const setRes = await window.pi.ws.setCwd(res.path);
	if (setRes.ok) {
		currentCwd = res.path;
		cwdLabel.textContent = res.path;
		cwdPill.textContent = res.path;
		expandedDirs.clear();
		await loadDirectory(currentCwd, fileTree, false);
		messagesEl.innerHTML = "";
		active = undefined;
		setStatus(`已切换到工作目录: ${res.path}`, "");
	} else {
		setStatus(`切换工作目录失败: ${setRes.error}`, "error");
	}
}

// ---- File context menu ----
function fileMenu(entry: any) {
	// Lightweight inline context menu.
	const existing = document.querySelector(".ctx-menu");
	if (existing) existing.remove();

	const menu = document.createElement("div");
	menu.className = "ctx-menu";
	const items: Array<{ label: string; run: () => void }> = [
		{ label: "复制路径", run: () => navigator.clipboard.writeText(entry.path) },
	];
	if (entry.type === "file") {
		items.unshift({ label: "在编辑器中打开", run: () => openFile(entry.path) });
	}
	items.push(
		{ label: "重命名…", run: () => doRename(entry) },
		{ label: "删除", run: () => doDelete(entry) },
	);

	for (const it of items) {
		const b = document.createElement("button");
		b.textContent = it.label;
		b.addEventListener("click", () => {
			menu.remove();
			it.run();
		});
		menu.appendChild(b);
	}
	menu.style.left = "260px";
	menu.style.top = "40px";
	document.body.appendChild(menu);

	const dismiss = (e: MouseEvent) => {
		if (!menu.contains(e.target as Node)) close();
	};
	const close = () => {
		document.removeEventListener("click", dismiss);
		menu.remove();
	};
	setTimeout(() => document.addEventListener("click", dismiss), 10);
}

async function doRename(entry: any) {
	const name = prompt("重命名（只填新名称）：", entry.name);
	if (!name || name === entry.name) return;
	const parent = entry.path.slice(0, entry.path.length - entry.name.length);
	const res = await window.pi.ws.rename(entry.path, parent + name);
	if (res.ok) {
		await rehydrateTree();
	} else {
		setStatus(`重命名失败: ${res.error}`, "error");
	}
}

async function doDelete(entry: any) {
	if (!confirm(`确认删除“${entry.name}”？${entry.type === "dir" ? "（仅空目录）" : ""}`)) return;
	const res = await window.pi.ws.delete(entry.path);
	if (res.ok) {
		if (editor?.path === entry.path) closeEditor();
		await rehydrateTree();
	} else {
		setStatus(`删除失败: ${res.error}`, "error");
	}
}

// ---- Create file / dir ----
async function onCreateNode() {
	const kind = prompt("输入名称。以 / 结尾创建目录，否则创建文件：", "");
	if (!kind) return;
	const wantDir = kind.endsWith("/");
	const baseName = wantDir ? kind.slice(0, -1) : kind;
	if (!baseName.trim()) return;
	const res = await window.pi.ws.create(currentCwd, baseName, wantDir ? "dir" : "file");
	if (res.ok) {
		await rehydrateTree();
		if (!wantDir) openFile(res.path);
	} else {
		setStatus(`创建失败: ${res.error}`, "error");
	}
}

/** Insert @path references into the chat input at the caret. */
function appendRefs(paths: string[]) {
	let text = paths.map((p) => `@${p}`).join(" ");
	const caret = inputEl.selectionStart ?? inputEl.value.length;
	const before = inputEl.value.slice(0, caret);
	const after = inputEl.value.slice(caret);
	const sep = before.length && !/\s$/.test(before) ? " " : "";
	inputEl.value = before + sep + text + (after ? " " + after : "");
	const newPos = (before + sep + text).length;
	inputEl.selectionStart = inputEl.selectionEnd = newPos;
	inputEl.focus();
	updateSendButtonForInput();
}

// =====================================================================
// Git panel
// =====================================================================

async function loadGit() {
	gitStatusEl.innerHTML = '<div class="git-empty">加载中…</div>';
	const res = await window.pi.git.info();
	if (!res.ok) {
		gitStatusEl.innerHTML = `<div class="git-empty">Git 错误: ${res.error ?? res}</div>`;
		return;
	}
	if (!res.isRepo) {
		gitStatusEl.innerHTML = '<div class="git-empty">当前目录不是 Git 仓库</div>';
		gitBranch.textContent = "Git";
		gitPanel.hidden = false;
		return;
	}
	gitBranch.textContent = `⤴ ${res.branch || "(无分支)"}`;
	if (!res.status.length) {
		gitStatusEl.innerHTML = '<div class="git-empty">工作区干净 ✨</div>';
		return;
	}
	gitStatusEl.innerHTML = "";
	for (const item of res.status) {
		const row = document.createElement("div");
		row.className = "git-item";
		const code = document.createElement("span");
		code.className = `code ${item.status}`;
		code.textContent = item.status;
		const path = document.createElement("span");
		path.className = "path";
		path.textContent = item.filePath;
		const label = document.createElement("span");
		label.className = "label";
		label.textContent = item.label;
		row.appendChild(code);
		row.appendChild(path);
		row.appendChild(label);
		row.addEventListener("click", () => showDiff(item.filePath));
		gitStatusEl.appendChild(row);
	}
}

async function showDiff(filePath: string) {
	const res = await window.pi.git.diff(filePath);
	gitDiffFile.textContent = filePath;
	gitDiffEl.textContent = res.ok && res.stdout ? res.stdout : "(无 diff)";
	gitDiffWrap.hidden = false;
}

// =====================================================================
// Markdown / file preview
// =====================================================================

function isPreviewableFile(file: string) {
	if (/\.(md|markdown|mdown|mkd)$/i.test(file)) return true;
	if (/\.(html|htm)$/i.test(file)) return true;
	return false;
}

function previewKindOf(file: string): "md" | "html" | "pdf" | "docx" | "none" {
	if (/\.(md|markdown|mdown|mkd)$/i.test(file)) return "md";
	if (/\.(html|htm)$/i.test(file)) return "html";
	if (/\.pdf$/i.test(file)) return "pdf";
	if (/\.docx$/i.test(file)) return "docx";
	return "none";
}

function setEditorPreviewable(previewable: boolean) {
	previewToggle.checked = previewable;
	previewToggle.parentElement!.style.visibility = previewable ? "visible" : "hidden";
	updateSplitVisibility();
}

/** Apply the wrap-on/off setting to both editor and preview. */
function applyWrap(on: boolean) {
	fileEditor?.setLineWrapping(on);
	previewContentEl.classList.toggle("nowrap", !on);
}

function updateSplitVisibility() {
	const on = previewToggle.checked && previewKind !== "none";
	previewPane.classList.toggle("preview-off", !on);
	const splitResizer = editorBodies.querySelector(".resizer-split") as HTMLDivElement | null;
	if (splitResizer) splitResizer.style.display = on ? "" : "none";
}

function onPreviewToggle() {
	updateSplitVisibility();
	if (previewToggle.checked) updatePreview();
}

async function renderPreviewFor(file: string) {
	const kind = previewKindOf(file);
	previewKind = kind;
	if (kind === "none") {
		updateSplitVisibility();
		return;
	}
	if (kind === "md") {
		cmContainer.style.display = "";
		previewFrame.hidden = true;
		previewContentEl.hidden = false;
		previewContentEl.innerHTML = renderMarkdown(fileEditor.getContent());
	} else if (kind === "html") {
		cmContainer.style.display = "";
		previewContentEl.hidden = true;
		previewFrame.hidden = false;
		previewFrame.srcdoc = fileEditor.getContent();
	} else if (kind === "pdf") {
		await showPdfPreview(file);
	} else if (kind === "docx") {
		await showDocxPreview(file);
	}
	previewToggle.checked = true;
	updateSplitVisibility();
}

async function showPdfPreview(file: string) {
	const res = await window.pi.ws.readBinary(file);
	if (!res.ok) {
		showPlain(`PDF 读取失败: ${res.error}`);
		return;
	}
	const blob = base64ToBlob(res.base64, res.mime || "application/pdf");
	const url = URL.createObjectURL(blob);
	previewFrame.hidden = false;
	previewContentEl.hidden = true;
	previewFrame.srcdoc = "";
	previewFrame.src = url;
	cmContainer.style.display = "none"; // PDF: preview fills the panel
}

async function showDocxPreview(file: string) {
	const res = await window.pi.ws.docxText(file);
	if (!res.ok) {
		showPlain(`Word 预览失败: ${res.error}`);
		return;
	}
	previewFrame.hidden = true;
	previewContentEl.hidden = false;
	const text = escapeHtml(res.text ?? "");
	previewContentEl.innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${text}</pre>`;
	cmContainer.style.display = "none"; // docx: preview fills panel
}

function showPlain(text: string) {
	previewFrame.hidden = true;
	previewContentEl.hidden = false;
	previewContentEl.innerHTML = escapeHtml(text);
}

function updatePreview() {
	if (!editor) return;
	const kind = previewKind;
	if (kind === "md") {
		previewContentEl.innerHTML = renderMarkdown(fileEditor.getContent());
	} else if (kind === "html") {
		previewFrame.srcdoc = fileEditor.getContent();
	}
}

function base64ToBlob(base64: string, mime: string): Blob {
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: mime });
}

// =====================================================================
// Panel drag-resizing (sidebar / main / editor)
// =====================================================================

function setupResizers() {
	const resizers = document.querySelectorAll<HTMLDivElement>(".resizer");
	for (const rz of resizers) {
		rz.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			startDrag(rz, e.clientX);
		});
	}
}

function startDrag(rz: HTMLDivElement, startX: number) {
	rz.classList.add("dragging");
	document.body.style.cursor = "col-resize";
	document.body.style.userSelect = "none";

	const bodyRect = rz.parentElement!.getBoundingClientRect();
	const bodyW = bodyRect.width;
	const sidebarEl = document.getElementById("sidebar") as HTMLElement;
	const editorPanelEl = document.getElementById("editor-panel") as HTMLElement;
	const isSidebar = rz.dataset.side === "sidebar";
	const isEditor = rz.dataset.side === "editor";
	const isSplit = rz.dataset.side === "split";

	let sidebarW = parseFloat(getComputedStyle(sidebarEl).width) || 280;
	let editorW = parseFloat(getComputedStyle(editorPanelEl).width) || 420;
	const sidebarBaseW = sidebarW;
	const editorBaseW = editorW;
	// Current editor vs preview split (preview width %, relative to bodies width)
	let previewBase = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--preview-w")) || 50;
	const bodiesW = (document.getElementById("editor-bodies") as HTMLElement).getBoundingClientRect().width;

	const onMove = (e: MouseEvent) => {
		const dx = e.clientX - startX;
		if (isSidebar) {
			sidebarW = Math.max(150, Math.min(600, sidebarBaseW + dx));
			document.documentElement.style.setProperty("--sidebar-w", sidebarW + "px");
		} else if (isEditor) {
			// editor width changes opposite the drag direction
			editorW = Math.max(240, Math.min(bodyW * 0.8, editorBaseW - dx));
			document.documentElement.style.setProperty("--editor-w", editorW + "px");
		} else if (isSplit) {
			// preview width grows when dragging left; but ratio is relative:
			let previewW = previewBase;
			if (bodiesW > 0) previewW = previewBase + (-dx / bodiesW) * 100;
			previewW = Math.max(15, Math.min(85, previewW));
			document.documentElement.style.setProperty("--preview-w", previewW + "%");
		}
	};

	const onUp = () => {
		document.removeEventListener("mousemove", onMove);
		document.removeEventListener("mouseup", onUp);
		rz.classList.remove("dragging");
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	};

	document.addEventListener("mousemove", onMove);
	document.addEventListener("mouseup", onUp);
}
