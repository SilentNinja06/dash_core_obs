import { tryParseJson } from "./directivesserde";

/**
 * Pure (Obsidian-free) serialization for the dashboard layout file.
 *
 * The layout — the mobile tabs, each card's tab assignment, the default tab, the
 * mobile-tabs toggle, plus panel order/enable/columns/spans — used to live only
 * in the plugin's `data.json`. That store syncs across devices ONLY with
 * "installed community plugins" enabled, and even then this vault has repeatedly
 * proven it unreliable across updates and devices (the same reason directives,
 * local events, quotes, and the AI credentials were all moved to Markdown). This
 * is precisely why the mobile tab system "reverted" on a plugin update: the tab
 * config was data.json-only, and a fresh/empty data.json on update erased it.
 *
 * Obsidian Sync ALWAYS syncs Markdown, so the layout now rides in a fenced `json`
 * block inside a `.md` file — a single object, so there is no multi-line array a
 * line-by-line sync merge could shred (cf. directives). `data.json` keeps a copy
 * too (the always-present local fallback); the synced file is authoritative and
 * repopulates any device whose data.json arrived empty.
 */
export interface DashTabRecord {
	id: string;
	name: string;
}

export interface DashLayout {
	mobileTabs?: boolean;
	tabs?: DashTabRecord[];
	tabAssignments?: Record<string, string>;
	defaultTabId?: string | null;
	panelOrder?: string[];
	enabledPanels?: Record<string, boolean>;
	panelColumns?: Record<string, number>;
	panelSpans?: Record<string, number>;
}

interface DashLayoutFile extends DashLayout {
	version: number;
}

/** Neutral default header. Parsing ignores it (only the fenced ```json block is
 * read), so a host can pass its own voiced header without affecting parsing. */
export const DEFAULT_LAYOUT_HEADER =
	"%% Dashboard — layout (synced). Mobile tabs, card assignments, and panel " +
	"order/columns. Managed automatically; edit it in the dashboard settings, not here. %%";

/** JSON payload wrapped in a fenced block inside a Markdown file. Single object,
 * so there is no multi-line array a sync merge could shred (cf. directives). */
export function buildLayoutMarkdown(layout: DashLayout, header: string = DEFAULT_LAYOUT_HEADER): string {
	const file: DashLayoutFile = { version: 1, ...layout };
	return `${header}\n\n\`\`\`json\n${JSON.stringify(file)}\n\`\`\`\n`;
}

/** Extract the layout, distinguishing a genuine parse from a failure — the same
 * contract as `tryParseAICreds`. `ok` is false when the JSON is unreadable or the
 * shape is wrong; callers MUST treat that as "could not read" and never persist
 * over the file, so a sync-conflicted / half-written file is preserved. An
 * empty-but-valid object is `ok` (a device that has a file but no tabs yet). */
export function tryParseLayout(raw: string): { ok: boolean; layout: DashLayout } {
	const r = tryParseJson(raw);
	const v = r?.value;
	if (!r || !v || typeof v !== "object" || Array.isArray(v)) return { ok: false, layout: {} };
	const o = v as Partial<DashLayoutFile>;
	const layout: DashLayout = {};
	if (typeof o.mobileTabs === "boolean") layout.mobileTabs = o.mobileTabs;
	if (Array.isArray(o.tabs)) {
		layout.tabs = o.tabs.filter((t): t is DashTabRecord => !!t && typeof t.id === "string" && typeof t.name === "string").map((t) => ({ id: t.id, name: t.name }));
	}
	if (o.tabAssignments && typeof o.tabAssignments === "object") {
		layout.tabAssignments = {};
		for (const [k, val] of Object.entries(o.tabAssignments)) if (typeof val === "string") layout.tabAssignments[k] = val;
	}
	if (typeof o.defaultTabId === "string" || o.defaultTabId === null) layout.defaultTabId = o.defaultTabId;
	if (Array.isArray(o.panelOrder)) layout.panelOrder = o.panelOrder.filter((p): p is string => typeof p === "string");
	if (o.enabledPanels && typeof o.enabledPanels === "object") {
		layout.enabledPanels = {};
		for (const [k, val] of Object.entries(o.enabledPanels)) if (typeof val === "boolean") layout.enabledPanels[k] = val;
	}
	layout.panelColumns = pickNumberMap(o.panelColumns);
	layout.panelSpans = pickNumberMap(o.panelSpans);
	if (!layout.panelColumns) delete layout.panelColumns;
	if (!layout.panelSpans) delete layout.panelSpans;
	return { ok: true, layout };
}

function pickNumberMap(map: unknown): Record<string, number> | undefined {
	if (!map || typeof map !== "object") return undefined;
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(map as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
	return Object.keys(out).length ? out : undefined;
}

/** Whether a layout carries anything worth syncing. Used to decide whether to
 * mint the file on the one-time migration seed — we never originate a file for a
 * user who never customized their layout (nothing to preserve, and an empty file
 * that then syncs could clobber another device that DID have a config). A
 * deliberate settings edit writes regardless; this gate is for the auto seed. */
export function layoutHasContent(layout: DashLayout): boolean {
	return (
		(layout.tabs?.length ?? 0) > 0 ||
		Object.keys(layout.tabAssignments ?? {}).length > 0 ||
		(layout.panelOrder?.length ?? 0) > 0 ||
		Object.keys(layout.enabledPanels ?? {}).length > 0 ||
		Object.keys(layout.panelColumns ?? {}).length > 0 ||
		Object.keys(layout.panelSpans ?? {}).length > 0
	);
}
