import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, historyKeymap, history, indentWithTab } from "@codemirror/commands";
import {
	indentOnInput,
	bracketMatching,
	foldGutter,
	defaultHighlightStyle,
	syntaxHighlighting,
} from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";

const languageCompartment = new Compartment();
const editableCompartment = new Compartment();
const wrapCompartment = new Compartment();

/** Returns the appropriate CodeMirror language extension for a filename. */
function languageFor(name: string) {
	const base = name.toLowerCase();
	if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(base)) return javascript();
	if (/\.(ts)$/.test(base)) return javascript();
	if (/\.(json|jsonc)$/.test(base)) return json();
	if (/\.(md|markdown)$/.test(base)) return markdown();
	if (/\.(css|scss|less)$/.test(base)) return css();
	if (/\.(html|htm|vue|svelte)$/.test(base)) return html();
	return javascript();
}

/**
 * A thin wrapper around a CodeMirror 6 editor used as the file editor panel.
 */
export class FileEditor {
	view: EditorView;
	private container: HTMLElement;
	onChange: (() => void) | undefined;

	constructor(container: HTMLElement) {
		this.container = container;
		const state = EditorState.create({
			doc: "",
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				drawSelection(),
				foldGutter(),
				history(),
				indentOnInput(),
				bracketMatching(),
				keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
				syntaxHighlighting(defaultHighlightStyle),
				oneDark,
				languageCompartment.of(javascript()),
				editableCompartment.of(EditorView.editable.of(true)),
				wrapCompartment.of([]),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) this.onChange?.();
				}),
			],
		});
		this.view = new EditorView({ state, parent: container });
	}

	/** Set the document content and select the matching syntax highlight. */
	setContent(content: string, filename: string) {
		this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: content } });
		this.view.dispatch({ effects: languageCompartment.reconfigure(languageFor(filename)) });
	}

	getContent(): string {
		return this.view.state.doc.toString();
	}

	/** Enable or disable editing (used for binary/read-only files and when closed). */
	enable(flag: boolean) {
		this.view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(flag)) });
	}

	/** Toggle line wrapping. Default is OFF (long lines scroll horizontally). */
	setLineWrapping(on: boolean) {
		this.view.dispatch({ effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []) });
	}

	focus() {
		this.view.focus();
	}

	scrollToTop() {
		this.view.scrollDOM.scrollTop = 0;
	}

	destroy() {
		this.view.destroy();
		this.container.innerHTML = "";
	}
}
