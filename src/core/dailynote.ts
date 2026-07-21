import { App, MarkdownView, TFile, TFolder, moment, normalizePath } from "obsidian";

/**
 * The daily-note contract (§6). Every write to the daily note goes through
 * this module. Rules that live here and nowhere else:
 *
 *  - Path/format/template come from the *core Daily Notes plugin's own
 *    options* — never hardcoded (§6, §12). Mirrors ARFID_obs/src/dailynote.ts.
 *  - Writes use `app.vault.process()` (atomic read-modify-write) — never a
 *    read-then-write, which races Obsidian Sync and a user edit (LANDMINE §6).
 *  - If today's note is open in another leaf, we reconcile against the *live
 *    editor content*, editing only the target range, instead of clobbering
 *    the file on disk under the editor (LANDMINE §6). No duplicate content.
 *  - Heading matchers are colon-free (LANDMINE §6): the template dropped the
 *    colons, and every matcher here targets the colon-free form (while still
 *    tolerating a stray colon defensively).
 */

interface DailyNotesOptions {
	folder?: string;
	format?: string;
	template?: string;
}

function getDailyNotesOptions(app: App): DailyNotesOptions {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const dn = (app as any).internalPlugins?.getPluginById?.("daily-notes");
	return dn?.instance?.options ?? {};
}

/** Resolve the vault path of the daily note for `date` (default today). */
export function dailyNotePath(app: App, date?: string): string {
	const opts = getDailyNotesOptions(app);
	const format = opts.format || "YYYY-MM-DD";
	const folder = (opts.folder ?? "").trim().replace(/\/+$/, "");
	const d = date ?? moment().format("YYYY-MM-DD");
	const name = moment(d, "YYYY-MM-DD").format(format);
	return normalizePath((folder ? folder + "/" : "") + name + ".md");
}

/** The daily note file for `date`, if it exists yet. */
export function getDailyNoteFile(app: App, date?: string): TFile | null {
	const f = app.vault.getAbstractFileByPath(dailyNotePath(app, date));
	return f instanceof TFile ? f : null;
}

/** Get (or create, from the core template) today's daily note. Never creates
 * a second note for the day — the path is resolved from the plugin's options. */
export async function ensureDailyNote(app: App, date?: string): Promise<TFile> {
	const path = dailyNotePath(app, date);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	await ensureParentFolder(app, path);
	const opts = getDailyNotesOptions(app);
	const body = await renderDailyTemplate(app, opts, path, date ?? moment().format("YYYY-MM-DD"));
	// Guard the race where the file appears between the check and create.
	const raced = app.vault.getAbstractFileByPath(path);
	if (raced instanceof TFile) return raced;
	return app.vault.create(path, body);
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
	const dir = path.split("/").slice(0, -1).join("/");
	if (!dir) return;
	if (app.vault.getAbstractFileByPath(dir) instanceof TFolder) return;
	await app.vault.createFolder(dir).catch(() => {});
}

/** Seed a new daily note from the core Daily Notes template, substituting the
 * {{title}} / {{date}} / {{time}} placeholders. Empty if no template set. */
async function renderDailyTemplate(
	app: App,
	opts: DailyNotesOptions,
	dailyPath: string,
	date: string
): Promise<string> {
	const templateSetting = (opts.template ?? "").trim();
	if (!templateSetting) return "";
	const templatePath = normalizePath(
		templateSetting.endsWith(".md") ? templateSetting : templateSetting + ".md"
	);
	const tFile = app.vault.getAbstractFileByPath(templatePath);
	if (!(tFile instanceof TFile)) return "";
	const raw = await app.vault.cachedRead(tFile);
	const basename = dailyPath.split("/").pop()?.replace(/\.md$/, "") ?? "";
	const m = moment(date, "YYYY-MM-DD");
	const now = moment();
	return raw
		.replace(/{{\s*title\s*}}/gi, basename)
		.replace(/{{\s*date(?::([^}]+))?\s*}}/gi, (_, fmt) => m.format(fmt || "YYYY-MM-DD"))
		.replace(/{{\s*time(?::([^}]+))?\s*}}/gi, (_, fmt) => now.format(fmt || "HH:mm"));
}

// ---------------------------------------------------------------- sections

/** A region of the daily note the dashboard reads or replaces. The body is the
 * lines *after* the anchor line, up to (but not including) the first stop line
 * or the next markdown heading. */
export interface FieldSpec {
	/** Matches the line that immediately precedes the body. */
	anchor: RegExp;
	/** Extra lines (besides any heading) that terminate the body. */
	stops?: RegExp[];
	/** Whether a markdown heading terminates the body (default true). */
	stopAtHeading?: boolean;
}

const HEADING_RE = /^#{1,6}\s/;

/** Colon-tolerant heading field: body runs to the next heading. */
export function headingField(heading: string): FieldSpec {
	const esc = heading.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return { anchor: new RegExp(`^#{1,6}\\s+${esc}:?\\s*$`, "i") };
}

/** A `- Label:` bullet field within the note, stopping before the given lines. */
export function labelField(label: string, stops: RegExp[]): FieldSpec {
	const esc = label.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return { anchor: new RegExp(`^\\s*-\\s+${esc}\\s*:?\\s*$`, "i"), stops };
}

interface Range {
	anchorIdx: number;
	start: number; // first body line index (inclusive)
	end: number; // one past last body line index (exclusive)
}

function locate(lines: string[], spec: FieldSpec): Range | null {
	const anchorIdx = lines.findIndex((l) => spec.anchor.test(l));
	if (anchorIdx === -1) return null;
	const stopAtHeading = spec.stopAtHeading !== false;
	let end = lines.length;
	for (let i = anchorIdx + 1; i < lines.length; i++) {
		if (stopAtHeading && HEADING_RE.test(lines[i])) {
			end = i;
			break;
		}
		if (spec.stops?.some((re) => re.test(lines[i]))) {
			end = i;
			break;
		}
	}
	return { anchorIdx, start: anchorIdx + 1, end };
}

/** Read the trimmed body of a field from raw note content. "" if absent. */
export function readField(content: string, spec: FieldSpec): string {
	const lines = content.split("\n");
	const r = locate(lines, spec);
	if (!r) return "";
	return lines.slice(r.start, r.end).join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

/** Replace the body of a field in raw content. If the anchor is absent the
 * content is returned unchanged (the field lives in the template; we never
 * invent headings for free-text panels). */
export function replaceField(content: string, spec: FieldSpec, body: string): string {
	const lines = content.split("\n");
	const r = locate(lines, spec);
	if (!r) return content;
	const bodyLines = body.replace(/\s+$/, "").split("\n");
	// Normalise to: anchor, blank line, body..., blank line before boundary.
	const replacement = body.trim() ? ["", ...bodyLines, ""] : [""];
	lines.splice(r.start, r.end - r.start, ...replacement);
	return lines.join("\n");
}

// --------------------------------------------------------- log-line append

const PLUGIN_LOG_LINE = /^- \d{2}:\d{2}\b/;

/** Insert `line` under a marker (preferred), else a heading, else append the
 * heading at the end. Chronological among the plugin's own `- HH:MM …` lines.
 * Colon-tolerant heading match. Idempotent on an identical line. */
export function insertLogLine(
	content: string,
	line: string,
	opts: { marker?: string; heading: string; time: string }
): string {
	const lines = content.split("\n");
	if (lines.some((l) => l.trim() === line.trim())) return content;

	let anchor = -1;
	const marker = opts.marker?.trim();
	if (marker) anchor = lines.findIndex((l) => l.includes(marker));
	if (anchor === -1) {
		const heading = opts.heading.trim().toLowerCase().replace(/:$/, "");
		anchor = lines.findIndex((l) => {
			const m = l.match(/^#{1,6}\s+(.*?)\s*$/);
			return !!m && m[1].trim().toLowerCase().replace(/:$/, "") === heading;
		});
	}
	if (anchor === -1) {
		const trimmed = content.replace(/\n+$/, "");
		return (trimmed ? trimmed + "\n\n" : "") + `# ${opts.heading.replace(/:$/, "")}\n${line}\n`;
	}

	let insertAt = anchor + 1;
	while (insertAt < lines.length && PLUGIN_LOG_LINE.test(lines[insertAt])) {
		const existingTime = lines[insertAt].slice(2, 7);
		if (existingTime > opts.time) break;
		insertAt++;
	}
	lines.splice(insertAt, 0, line);
	return lines.join("\n");
}

// ------------------------------------------------ open-editor reconciliation

/** The live editor for today's note, if the user has it open in a leaf. */
function openEditorFor(app: App, file: TFile): MarkdownView | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) return view;
	}
	return null;
}

/** Apply `transform` to today's note. If the note is open in an editor, edit
 * the live buffer in place (reconcile — no disk clobber under the editor);
 * otherwise use vault.process (atomic, Sync-safe). */
async function editDailyNote(
	app: App,
	transform: (content: string) => string,
	date?: string
): Promise<void> {
	const file = await ensureDailyNote(app, date);
	const view = openEditorFor(app, file);
	if (view) {
		const editor = view.editor;
		const before = editor.getValue();
		const after = transform(before);
		if (after !== before) {
			// Replace only the minimal changed span so cursor/scroll survive
			// wherever the user isn't being overwritten.
			const { from, to, text } = minimalDiff(before, after);
			editor.replaceRange(text, editor.offsetToPos(from), editor.offsetToPos(to));
		}
		return;
	}
	await app.vault.process(file, transform);
}

/** Smallest replaced span between two strings: strip the common prefix and
 * suffix. Keeps edits local so an open editor barely flinches. */
function minimalDiff(a: string, b: string): { from: number; to: number; text: string } {
	let start = 0;
	const max = Math.min(a.length, b.length);
	while (start < max && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	return { from: start, to: endA, text: b.slice(start, endB) };
}

/** Write the body of a free-text field into today's note (§7.6). */
export async function writeDailyField(app: App, spec: FieldSpec, body: string): Promise<void> {
	await editDailyNote(app, (content) => replaceField(content, spec, body));
}

/** Append a line of text to a free-text field's body, preserving what's there
 * (§1.1 log commands / URI). Goes through the same reconcile-safe writer as the
 * Daily Log panel; a no-op (returns false) when the field's anchor is absent —
 * we never invent headings. */
export async function appendToDailyField(app: App, spec: FieldSpec, text: string): Promise<boolean> {
	const clean = text.trim();
	if (!clean) return false;
	const file = getDailyNoteFile(app);
	if (file) {
		// If the section's anchor isn't present, there's nothing to append to.
		const raw = await readDailyNoteRaw(app);
		if (!raw.split("\n").some((l) => spec.anchor.test(l))) return false;
	}
	const current = await readDailyField(app, spec);
	const next = current ? `${current}\n${clean}` : clean;
	await writeDailyField(app, spec, next);
	return true;
}

/** Read the current body of a free-text field from today's note — from the
 * live editor if open, else from disk. */
export async function readDailyField(app: App, spec: FieldSpec): Promise<string> {
	const file = getDailyNoteFile(app);
	if (!file) return "";
	const view = openEditorFor(app, file);
	const content = view ? view.editor.getValue() : await app.vault.cachedRead(file);
	return readField(content, spec);
}

/** Append a `- HH:MM …` log line to today's note under a marker/heading. */
export async function appendDailyLogLine(
	app: App,
	line: string,
	opts: { marker?: string; heading: string; time: string }
): Promise<void> {
	await editDailyNote(app, (content) => insertLogLine(content, line, opts));
}

/** Read the raw body under a heading from an arbitrary file's content. */
export function readHeadingSection(content: string, heading: string): string {
	return readField(content, headingField(heading));
}

/** Raw content of today's note — from the live editor if open, else disk. "" if
 * the note doesn't exist yet. */
export async function readDailyNoteRaw(app: App, date?: string): Promise<string> {
	const file = getDailyNoteFile(app, date);
	if (!file) return "";
	const view = openEditorFor(app, file);
	return view ? view.editor.getValue() : app.vault.cachedRead(file);
}

/** Collect `- HH:MM …` lines that sit under a marker (or heading) — the shape
 * ARFID and Spiral write into the daily note. Used as the read fallback when a
 * plugin's API is absent (§8). */
export function readMarkerLogLines(content: string, marker: string, heading?: string): string[] {
	const lines = content.split("\n");
	let anchor = lines.findIndex((l) => l.includes(marker));
	if (anchor === -1 && heading) {
		const h = heading.trim().toLowerCase().replace(/:$/, "");
		anchor = lines.findIndex((l) => {
			const m = l.match(/^#{1,6}\s+(.*?)\s*$/);
			return !!m && m[1].trim().toLowerCase().replace(/:$/, "") === h;
		});
	}
	if (anchor === -1) return [];
	const out: string[] = [];
	for (let i = anchor + 1; i < lines.length; i++) {
		if (HEADING_RE.test(lines[i])) break;
		if (/^- \d{2}:\d{2}\b/.test(lines[i])) out.push(lines[i]);
		else if (lines[i].includes("%%") && !lines[i].includes(marker)) break;
	}
	return out;
}
