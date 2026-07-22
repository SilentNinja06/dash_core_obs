import type { LocalEvent } from "./localevents";

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
	const json = JSON.stringify({ version: 1, events } as LocalEventsFile, null, 2);
	return `${header}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}

/** Extract the events from a local-events file. Tolerates a fenced ```json
 * block (current format) and a raw-JSON body (legacy `.json`). */
export function parseLocalEvents(raw: string): LocalEvent[] {
	const fenced = raw.match(/```json\s*([\s\S]*?)```/);
	const candidate = fenced ? fenced[1] : raw;
	try {
		const parsed = JSON.parse(candidate) as LocalEventsFile;
		return Array.isArray(parsed?.events) ? parsed.events.filter(isLocalEvent) : [];
	} catch {
		return [];
	}
}
