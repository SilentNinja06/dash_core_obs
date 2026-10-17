import type { LocalEvent } from "./localevents";
import { tryParseJson } from "./directivesserde";

/**
 * Pure (Obsidian-free) serialization for the local-events Markdown file,
 * extracted so the round-trip can be unit-tested. The events are stored as JSON
 * inside a fenced block in a `.md` file — Markdown always syncs via Obsidian
 * Sync, so local events cross devices (see LocalEventsFileStore for the full
 * rationale, which is the same one DirectivesStore documents).
 */
interface LocalEventsFile {
	version: number;
	events: LocalEvent[];
}

/** Neutral default header. `parseLocalEvents` ignores the header entirely (it
 * only reads the fenced ```json block), so the header is write-only chrome — a
 * host passes its own voiced header to keep its on-disk format exact, while an
 * existing file written with any other header still parses. */
export const DEFAULT_LOCAL_EVENTS_HEADER =
	"%% Dashboard — local (dashboard-only) schedule events. Managed automatically; " +
	"edit these in the dashboard, not here. %%";

/** Keep only well-formed events, so a hand-mangled file can't inject junk into
 * the agenda. `start`/`end` stay optional (absent means all-day). */
function isLocalEvent(e: unknown): e is LocalEvent {
	if (!e || typeof e !== "object") return false;
	const r = e as Record<string, unknown>;
	return (
		typeof r.id === "string" &&
		typeof r.date === "string" &&
		typeof r.summary === "string" &&
		(r.start === undefined || typeof r.start === "string") &&
		(r.end === undefined || typeof r.end === "string")
	);
}

/** JSON payload wrapped in a fenced block inside a Markdown file. The `header`
 * is host-supplied chrome (defaulting to a neutral line); it never affects
 * parsing, only the human-readable comment at the top of the file. */
export function buildLocalEventsMarkdown(events: LocalEvent[], header: string = DEFAULT_LOCAL_EVENTS_HEADER): string {
	// One event per line (compact), never pretty-printed across many lines — so a
	// line-level sync merge keeps or drops whole (valid) event lines instead of
	// interleaving two devices' versions into corrupt JSON. Same rationale as
	// buildMarkdown in directivesserde.ts.
	const body = events.length
		? `{\n  "version": 1,\n  "events": [\n${events.map((e) => "    " + JSON.stringify(e)).join(",\n")}\n  ]\n}`
		: `{\n  "version": 1,\n  "events": []\n}`;
	return `${header}\n\n\`\`\`json\n${body}\n\`\`\`\n`;
}

/** Extract the events, distinguishing a genuine parse from a failure — the same
 * contract as `tryParseTodos`. `ok` is false when the JSON is unreadable or the
 * shape is wrong; callers MUST treat that as "could not read" and never persist
 * over the file, or a sync-conflicted / half-written file would be overwritten. */
export function tryParseLocalEvents(raw: string): { ok: boolean; events: LocalEvent[] } {
	const r = tryParseJson(raw);
	const events = (r?.value as LocalEventsFile | undefined)?.events;
	if (r && Array.isArray(events)) return { ok: true, events: events.filter(isLocalEvent) };
	return { ok: false, events: [] };
}

/** Extract the events from a local-events file. Tolerates a fenced ```json
 * block (current format) and a raw-JSON body (legacy `.json`). Returns [] on a
 * parse failure — prefer `tryParseLocalEvents` where losing data must be avoided. */
export function parseLocalEvents(raw: string): LocalEvent[] {
	return tryParseLocalEvents(raw).events;
}

/** Preserve every on-disk event and append any local event whose id isn't on disk
 * (see `unionById` for directives — same first-save-before-load rationale). */
export function unionEventsById(onDisk: LocalEvent[], local: LocalEvent[]): LocalEvent[] {
	const seen = new Set(onDisk.map((e) => e.id));
	return [...onDisk, ...local.filter((e) => !seen.has(e.id))];
}
