/**
 * Chat input `@` file autocomplete.
 * Tracks the textarea, detects a pending `@query`, queries the workspace,
 * and shows a dropdown to insert `@path`.
 */
export class MentionAutocomplete {
	private input: HTMLTextAreaElement;
	private container: HTMLElement;
	private popup: HTMLDivElement | null = null;
	private onInsert: (text: string) => void;
	private searchImpl: (query: string) => Promise<any[]>;
	private list: any[] = [];
	private active = -1;

	constructor(opts: {
		input: HTMLTextAreaElement;
		container: HTMLElement;
		search: (query: string) => Promise<any[]>;
		onInsert: (text: string) => void;
	}) {
		this.input = opts.input;
		this.container = opts.container;
		this.searchImpl = opts.search;
		this.onInsert = opts.onInsert;

		this.input.addEventListener("input", () => this.schedule());
		this.input.addEventListener("keydown", (e) => this.onKey(e));
		this.input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
	}

	private schedule() {
		setTimeout(() => this.update(), 30);
	}

	/** Find the `@query` currently being typed directly before caret. */
	private currentQuery(): { start: number; q: string } | null {
		const pos = this.input.selectionStart;
		const text = this.input.value;
		let i = pos - 1;
		// walk back to @ or a whitespace
		let start = pos;
		for (; i >= 0; i--) {
			const ch = text[i];
			if (ch === "@") {
				start = i;
				break;
			}
			if (/\s/.test(ch)) break;
		}
		if (start >= pos) return null;
		const q = text.slice(start + 1, pos);
		if (q.length >= 20) return null;
		return { start, q };
	}

	private async update() {
		const ctx = this.currentQuery();
		if (!ctx) {
			this.close();
			return;
		}
		try {
			const res = await this.searchImpl(ctx.q);
			this.list = (res ?? []).slice(0, 20);
		} catch {
			this.list = [];
		}
		if (this.list.length === 0) {
			this.close();
			return;
		}
		this.render(ctx.start, ctx.q);
	}

	private render(start: number, q: string) {
		let pop = this.popup;
		if (!pop) {
			pop = document.createElement("div");
			pop.className = "mention-popup";
			this.container.appendChild(pop);
			this.popup = pop;
		}
		pop.innerHTML = "";
		if (this.active >= this.list.length) this.active = 0;
		this.list.forEach((item, idx) => {
			const row = document.createElement("div");
			row.className = "mention-row" + (idx === this.active ? " active" : "");
			const icon = document.createElement("span");
			icon.className = "mi";
			icon.textContent = item.type === "dir" ? "📁" : "📄";
			const name = document.createElement("span");
			name.className = "mn";
			name.textContent = item.name;
			const path = document.createElement("span");
			path.className = "mp";
			path.textContent = item.path;
			row.appendChild(icon);
			row.appendChild(name);
			row.appendChild(path);
			row.addEventListener("mousedown", (e) => {
				e.preventDefault();
			this.insert(start, item);
			});
			pop.appendChild(row);
		});
	}

	private onKey(e: KeyboardEvent) {
		if (!this.popup || this.list.length === 0) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const d = e.key === "ArrowDown" ? 1 : -1;
			this.active = (this.active + d + this.list.length) % this.list.length;
			this.highlight();
		} else if (e.key === "Enter" || e.key === "Tab") {
			if (this.active >= 0 && this.active < this.list.length) {
				e.preventDefault();
				const ctx = this.currentQuery();
				if (ctx) this.insert(ctx.start, this.list[this.active]);
			}
		} else if (e.key === "Escape") {
			this.close();
		}
	}

	private highlight() {
		if (!this.popup) return;
		const rows = this.popup.querySelectorAll(".mention-row");
		rows.forEach((r, i) => r.classList.toggle("active", i === this.active));
	}

	/** Replace the `@query` with `@path` in the input. */
	private insert(start: number, item: any) {
		const before = this.input.value.slice(0, start);
		const after = this.input.value.slice(this.input.selectionStart);
		const insertText = `@${item.path}`;
		this.input.value = before + insertText + (after.startsWith(" ") || after === "" ? "" : " ") + after;
		const newPos = before.length + insertText.length + 1;
		this.input.selectionStart = this.input.selectionEnd = newPos;
		this.onInsert?.(insertText);
		this.close();
		this.input.focus();
	}

	close() {
		if (this.popup) {
			this.popup.remove();
			this.popup = null;
		}
		this.list = [];
		this.active = -1;
	}
}
