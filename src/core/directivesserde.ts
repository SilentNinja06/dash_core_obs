import type { TodoItem } from "./todostore";

/**
 * Pure (Obsidian-free) serialization for the Directives Markdown file, extracted
 * so the round-trip can be unit-tested. The list is stored as JSON inside a
 * fenced block in a `.md` file — Markdown always syncs via Obsidian Sync, so the
 * directives cross devices (see DirectivesStore for the full rationale). New
 * optional `TodoItem` fields (sub-items, per-occurrence sub-completions, note)
 * ride along in the JSON with no format change.
 */
interface DirectivesFile {
	version: number;
	todos: TodoItem[];
}

/** Neutral default header. `parseTodos` ignores the header entirely (it only
 * reads the fenced ```json block), so the header is write-only chrome — a host
 * passes its own voiced header to `buildMarkdown` to keep its on-disk format
 * exact, while an existing file written with any other header still parses. */
export const DEFAULT_DIRECTIVES_HEADER =
	"%% Dashboard — persistent to-do list. Managed automatically; " +
	"edit these in the dashboard, not here. %%";

/** JSON payload wrapped in a fenced block inside a Markdown file. The `header`
 * is host-supplied chrome (defaulting to a neutral line); it never affects
 * parsing, only the human-readable comment at the top of the file. */
export function buildMarkdown(items: TodoItem[], header: string = DEFAULT_DIRECTIVES_HEADER): string {
	const json = JSON.stringify({ version: 1, todos: items } as DirectivesFile, null, 2);
	return `${header}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}

/** Extract the todo list from a directives file. Tolerates a fenced ```json
 * block (current format) and a raw-JSON body (legacy `.json`). */
export function parseTodos(raw: string): TodoItem[] {
	const fenced = raw.match(/```json\s*([\s\S]*?)```/);
	const candidate = fenced ? fenced[1] : raw;
	try {
		const parsed = JSON.parse(candidate) as DirectivesFile;
		return Array.isArray(parsed?.todos) ? parsed.todos : [];
	} catch {
		return [];
	}
}
