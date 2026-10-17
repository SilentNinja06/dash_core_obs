import { tryParseJson } from "./directivesserde";

/**
 * Generic, Obsidian-free serialization for a list of `{ id }` records stored as
 * JSON inside a fenced block in a Markdown file — the same sync-safe format the
 * directives use, generalized so any feature can persist a reliable, cross-device
 * list without re-deriving the reliability rules.
 *
 * Two properties make it safe under Obsidian Sync (which merges text line by line):
 *  - Each record is written on ONE compact line (arrays inline), so the smallest
 *    merge unit is a whole valid record. A concurrent edit keeps or drops an
 *    entire record line; it can never interleave a record's fields into invalid
 *    JSON (the corruption that blanked the directives list).
 *  - Parsing goes through `tryParseJson`, which recovers smart-quote damage, a
 *    renamed/removed fence, and structural sync-merge damage before giving up —
 *    and flags `recovered` so the store can rewrite the file back to clean form.
 */
export interface JsonListFile<T> {
	version: number;
	records: T[];
}

/** JSON payload wrapped in a fenced block. `header` is host chrome (a `%% … %%`
 * comment); it never affects parsing. One record per line — see the module doc. */
export function buildListMarkdown<T>(records: T[], header: string): string {
	const body = records.length
		? `{\n  "version": 1,\n  "records": [\n${records.map((r) => "    " + JSON.stringify(r)).join(",\n")}\n  ]\n}`
		: `{\n  "version": 1,\n  "records": []\n}`;
	return `${header}\n\n\`\`\`json\n${body}\n\`\`\`\n`;
}

/** Extract the records, distinguishing a genuine parse from a failure. `ok` is
 * false when the JSON is unreadable or the shape is wrong — callers MUST treat
 * that as "could not read" and never persist over the file, or a sync-conflicted
 * / half-written file would be overwritten and its records lost. An empty-but-valid
 * `records: []` is ok. `recovered` is true when parsing needed repair (so the
 * on-disk form is non-canonical and worth rewriting).
 *
 * `isValid` drops malformed entries so a hand-mangled file can't inject junk; it
 * defaults to "is a non-null object with a string id". */
export function tryParseList<T extends { id: string }>(
	raw: string,
	isValid: (r: unknown) => r is T = defaultIsRecord as (r: unknown) => r is T
): { ok: boolean; records: T[]; recovered: boolean } {
	const r = tryParseJson(raw);
	const records = (r?.value as JsonListFile<T> | undefined)?.records;
	if (r && Array.isArray(records)) return { ok: true, records: records.filter(isValid), recovered: r.recovered };
	return { ok: false, records: [], recovered: false };
}

function defaultIsRecord(r: unknown): r is { id: string } {
	return !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string";
}

/** Preserve every on-disk record and append any local record whose id isn't on
 * disk. Used only on the first save of a session where the file hadn't loaded yet
 * (secondary device, Sync still catching up): edits against an unloaded list can
 * only be additions, so this never drops a synced record and never duplicates one.
 * On-disk wins for a shared id. */
export function unionRecordsById<T extends { id: string }>(onDisk: T[], local: T[]): T[] {
	const seen = new Set(onDisk.map((r) => r.id));
	return [...onDisk, ...local.filter((r) => !seen.has(r.id))];
}
