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
 * parsing, only the human-readable comment at the top of the file.
 *
 * Layout matters for sync safety: each todo is written as ONE line (compact),
 * never pretty-printed across many lines. Obsidian Sync (and iCloud/Git) merge
 * text line by line, and a todo whose `completions` array had every date on its
 * own line is exactly what a merge shreds into invalid JSON — interleaving two
 * devices' versions into `,,`, missing commas, and duplicated/torn lines that
 * break JSON.parse and blank the whole list. With one todo per line, the
 * smallest merge unit is a whole todo: a concurrent edit keeps or drops an
 * entire (still-valid) todo line, and appending a completion touches only that
 * todo's line — the array can never be interleaved into corruption. */
export function buildMarkdown(items: TodoItem[], header: string = DEFAULT_DIRECTIVES_HEADER): string {
	const body = items.length
		? `{\n  "version": 1,\n  "todos": [\n${items.map((t) => "    " + JSON.stringify(t)).join(",\n")}\n  ]\n}`
		: `{\n  "version": 1,\n  "todos": []\n}`;
	return `${header}\n\n\`\`\`json\n${body}\n\`\`\`\n`;
}

/** Candidate JSON substrings to try, most-specific first: the fenced ```json
 * block, any fenced block (a linter may drop/rename the language), the outermost
 * `{ … }` (a mangled/removed fence still leaves the object), then the whole file. */
export function jsonCandidates(raw: string): string[] {
	const out: string[] = [];
	const fencedJson = raw.match(/```+\s*json\b\s*([\s\S]*?)```+/i);
	if (fencedJson) out.push(fencedJson[1]);
	const anyFence = raw.match(/```+[^\n]*\n([\s\S]*?)```+/);
	if (anyFence) out.push(anyFence[1]);
	const a = raw.indexOf("{");
	const b = raw.lastIndexOf("}");
	if (a >= 0 && b > a) out.push(raw.slice(a, b + 1));
	out.push(raw);
	return out;
}

/** Normalize the typographic substitutions that "smart punctuation" (Obsidian's
 * editor option, or a formatter/linter plugin) makes — curly quotes for straight,
 * non-breaking spaces — which turn otherwise-intact JSON into unparseable text
 * while leaving every character of the user's data present. Best-effort recovery. */
function deSmarten(s: string): string {
	return s
		.replace(/[“”„‟«»]/g, '"')
		.replace(/[‘’‚‛]/g, "'")
		.replace(/ /g, " ");
}

/** Extract the todo list, distinguishing a genuine parse from a failure. `ok` is
 * false when the JSON is unreadable or the shape is wrong — callers MUST treat
 * that as "could not read" and never persist over the file, or a sync-conflicted
 * / half-written directives file would be silently overwritten with an empty list
 * (permanent data loss across devices). An empty-but-valid `todos: []` is ok.
 *
 * Recovery: a file whose fence was renamed/removed, or whose quotes were turned
 * curly by smart-punctuation, still holds every byte of the list — so we try
 * several extraction candidates and a de-smartened retry before giving up, and
 * flag `recovered` so the caller can rewrite the file back to clean canonical form. */
/** Best-effort repair of the structural corruption a line-level sync merge
 * inflicts on a (historically) pretty-printed JSON list: two devices' versions
 * interleaved into `,,`, missing commas, trailing commas, torn/duplicated date
 * lines, and stray quotes. `JSON.parse` can't recover from any of these, so the
 * whole list reads as empty — the "directives keep clearing" report. This runs
 * only after the plain and de-smartened parses have already failed, so a clean
 * file never reaches it. Passes are ordered from most- to least-targeted:
 *
 *  1. Rebuild each `completions` / `skips` array from the ISO dates inside it.
 *     These date arrays are the high-churn lines a merge mangles; a date array
 *     never contains nested brackets, so we can lift every `YYYY-MM-DD`, dedupe,
 *     and re-emit a clean array — this alone fixes the worst interleaving.
 *  2. Collapse runs of commas (`,,` → `,`).
 *  3. Drop a trailing comma before `]` or `}`.
 *  4. Insert a missing comma between two strings adjacent across a line break
 *     (always invalid in JSON, so the comma is the only valid reading). */
export function repairJson(s: string): string {
	let out = s.replace(/"(completions|skips)"\s*:\s*\[([\s\S]*?)\]/g, (_m, key: string, inner: string) => {
		const dates = inner.match(/\d{4}-\d{2}-\d{2}/g) || [];
		const uniq = [...new Set(dates)];
		return `"${key}": [${uniq.map((d) => `"${d}"`).join(", ")}]`;
	});
	out = out.replace(/,(\s*,)+/g, ",");
	out = out.replace(/,(\s*[\]}])/g, "$1");
	out = out.replace(/"(\s*\n\s*)"/g, '",$1"');
	return out;
}

/** Parse the first JSON object recoverable from `raw`, trying each candidate and
 * a de-smartened retry, then a structural repair for sync-merge corruption.
 * `recovered` is true when anything but the plain first candidate succeeded (so
 * the on-disk form is non-canonical and worth rewriting). Shared by the
 * directives and local-events stores. */
export function tryParseJson(raw: string): { value: unknown; recovered: boolean } | null {
	const candidates = jsonCandidates(raw);
	for (let i = 0; i < candidates.length; i++) {
		const desmartened = deSmarten(candidates[i]);
		const variants = [candidates[i], desmartened, repairJson(desmartened)];
		for (let v = 0; v < variants.length; v++) {
			try {
				return { value: JSON.parse(variants[v]), recovered: i > 0 || v > 0 };
			} catch {
				/* try the next candidate / variant */
			}
		}
	}
	return null;
}

export function tryParseTodos(raw: string): { ok: boolean; todos: TodoItem[]; recovered?: boolean } {
	const r = tryParseJson(raw);
	const todos = (r?.value as DirectivesFile | undefined)?.todos;
	if (r && Array.isArray(todos)) return { ok: true, todos, recovered: r.recovered };
	return { ok: false, todos: [] };
}

/** Extract the todo list from a directives file. Tolerates a fenced ```json
 * block (current format) and a raw-JSON body (legacy `.json`). Returns [] on a
 * parse failure — prefer `tryParseTodos` where losing data must be avoided. */
export function parseTodos(raw: string): TodoItem[] {
	return tryParseTodos(raw).todos;
}

/** Preserve every on-disk item and append any local item whose id isn't already
 * on disk. Used only on the first save of a session where the file hadn't loaded
 * yet (secondary device, Sync still catching up): edits against an unloaded list
 * can only be additions, so this never drops a synced reminder and never
 * duplicates one. On-disk wins for a shared id. */
export function unionById(onDisk: TodoItem[], local: TodoItem[]): TodoItem[] {
	const seen = new Set(onDisk.map((t) => t.id));
	return [...onDisk, ...local.filter((t) => !seen.has(t.id))];
}
