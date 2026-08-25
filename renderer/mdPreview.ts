import { marked } from "marked";
import DOMPurify from "dompurify";

// Configure marked with a safe, fast set of options.
marked.setOptions({
	gfm: true,
	breaks: true,
	async: false,
});

/**
 * Render Markdown to sanitized HTML for safe preview of file contents.
 */
export function renderMarkdown(md: string): string {
	const raw = marked.parse(md, { async: false }) as string;
	return DOMPurify.sanitize(raw);
}
