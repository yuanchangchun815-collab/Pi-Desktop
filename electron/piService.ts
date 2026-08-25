import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	type CreateAgentSessionRuntimeFactory,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

/**
 * PiService wraps the pi SDK's AgentSessionRuntime so the Electron main
 * process can run a fully-featured pi agent and stream events to the UI.
 */
export class PiService {
	private runtime!: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
	private unsubscribe: (() => void) | undefined;
	private cwdValue: string;
	private modelPattern: string | undefined;
	private thinkingLevel: string | undefined;

	/**
	 * Callback receiving every SDK event; the main process forwards these to
	 * the renderer through IPC.
	 */
	onEvent?: (event: unknown) => void;
	/** Callback when the active session is replaced (new/resume/fork). */
	onSessionReplaced?: (session: { id: string; file?: string; cwd: string }) => void;

	constructor(options: { cwd: string; modelPattern?: string; thinkingLevel?: string }) {
		this.cwdValue = options.cwd;
		this.modelPattern = options.modelPattern;
		this.thinkingLevel = options.thinkingLevel;
	}

	get sessionId() {
		return this.runtime?.session?.sessionId;
	}

	get sessionFile() {
		return this.runtime?.session?.sessionFile;
	}

	get cwd() {
		return this.runtime?.services?.cwd ?? this.cwdValue;
	}

	get isStreaming() {
		return this.runtime?.session?.isStreaming ?? false;
	}

	private get servicesCwd() {
		return this.runtime?.services?.cwd ?? this.cwdValue;
	}

	async init() {
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		this.runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: this.cwdValue,
			agentDir: getAgentDir(),
			sessionManager: SessionManager.create(this.cwdValue),
		});

		this.bindSession();

		// Apply model/thinking overrides if provided.
		if (this.modelPattern) {
			await this.selectModelByPattern(this.modelPattern);
		}
		if (this.thinkingLevel) {
			this.setThinkingLevel(this.thinkingLevel as Parameters<typeof this.setThinkingLevel>[0]);
		}

		this.emitSessionInfo();
		console.log("[pi-service] initialized. sessionId:", this.sessionId);
		return this;
	}

	/** Reinitialize against a new working directory. Disposes the old runtime. */
	async setCwd(newCwd: string) {
		this.unsubscribe?.();
		await this.runtime?.dispose();
		this.cwdValue = newCwd;
		await this.init();
		return this.sessionId;
	}

	private bindSession() {
		this.unsubscribe?.();
		const session = this.runtime.session;
		this.unsubscribe = session.subscribe((event) => {
			this.onEvent?.(event);
		});
		this.emitSessionInfo();
	}

	/** List models that currently have valid authentication configured. */
	async listAvailableModels(): Promise<Array<any>> {
		const modelRuntime = (this.runtime.services as any)?.modelRuntime;
		if (!modelRuntime) return [];
		try {
			const available = await modelRuntime.getAvailable();
			return available ?? [];
		} catch {
			return [];
		}
	}

	private emitSessionInfo() {
		const session = this.runtime?.session;
		this.onSessionReplaced?.({
			id: session?.sessionId ?? "",
			file: session?.sessionFile,
			cwd: this.servicesCwd,
		});
	}

	// ---- Prompting ------------------------------------------------------

	async prompt(text: string, streamingBehavior?: "steer" | "followUp") {
		const session = this.runtime.session;
		await session.prompt(text, streamingBehavior ? { streamingBehavior } : undefined);
	}

	async steer(text: string) {
		await this.runtime.session.steer(text);
	}

	async followUp(text: string) {
		await this.runtime.session.followUp(text);
	}

	async abort() {
		if (this.runtime.session.isStreaming) {
			await this.runtime.session.abort();
		}
	}

	// ---- Model control --------------------------------------------------

	async selectModelByPattern(pattern: string) {
		const session = this.runtime.session;
		// Try runtime-set model if the pattern matches a registered model.
		const modelRuntime = (this.runtime.services as any)?.modelRuntime;
		if (modelRuntime) {
			const [provider, ...rest] = pattern.split("/");
			const model = rest.length ? modelRuntime.getModel(provider, rest.join("/")) : undefined;
			if (model) {
				await session.setModel(model);
			}
		}
	}

	/** Set the active model from an object returned by listAvailableModels(). */
	async setModel(model: any) {
		if (!model || typeof model !== "object") return;
		await this.runtime.session.setModel(model);
	}

	setThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") {
		this.runtime.session.setThinkingLevel(level);
	}

	// ---- Session management ----------------------------------------------

	async newSession() {
		await this.runtime.newSession();
		this.bindSession();
		this.onSessionReplaced?.({
			id: this.runtime.session.sessionId,
			file: this.runtime.session.sessionFile,
			cwd: this.servicesCwd,
		});
	}

	async getSessions() {
		return SessionManager.listAll(this.cwdValue);
	}

	async switchSession(file: string) {
		await this.runtime.switchSession(file);
		this.bindSession();
		this.onSessionReplaced?.({
			id: this.runtime.session.sessionId,
			file: this.runtime.session.sessionFile,
			cwd: this.servicesCwd,
		});
	}

	async dispose() {
		this.unsubscribe?.();
		await this.runtime?.dispose();
	}
}
