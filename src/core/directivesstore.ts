import { App, TFile, TFolder, normalizePath } from "obsidian";
import { TodoItem } from "./todostore";
import { buildMarkdown, parseTodos } from "./directivesserde";

/**
 * Persistence for the Directives list as a **Markdown vault file**.
 *
 * Why Markdown specifically: the to-do list is the one piece of dashboard state
 * the user edits on both phone and desktop, so it must sync.
 * Obsidian Sync always syncs Markdown; a plugin's `data.json` only syncs with
 * "installed community plugins" enabled, and a plain `.json` vault file only
 * syncs with "Sync all other file types" enabled (off by default) — which is
 * why the checklists still weren't crossing devices. Storing the list as JSON
 * inside a `.md` file removes that dependency entirely. We reload it live when
 * the other device's copy lands.
 *
 * The JSON serialization itself lives in `directivesserde.ts` (Obsidian-free,
 * unit-tested).
 */
const DEFAULT_PATH = "Dashboard/Directives.md";

/** Host-supplied chrome that keeps core lore-free while letting each dashboard
 * preserve its own on-disk format and default location. */
export interface DirectivesStoreOptions {
	/** Voiced header line written at the top of the file (parsing ignores it).
	 * Omit for the neutral default in `buildMarkdown`. */
	header?: string;
	/** Fallback path when `getPath()` returns empty. */
	defaultPath?: string;
}

export class DirectivesStore {
	private items: TodoItem[] = [];
	/** The exact text we last read from / wrote to disk, so a modify event
	 * caused by our own write reloads to identical content and is ignored. */
	private lastSerialized = "";

	constructor(
		private app: App,
		private getPath: () => string,
		private opts: DirectivesStoreOptions = {}
	) {}

	getItems(): TodoItem[] {
		return this.items;
	}

	setItems(items: TodoItem[]): void {
		this.items = items;
	}

	/** The Markdown file the directives live in. Any configured extension is
	 * coerced to `.md` so the file always syncs. */
	path(): string {
		const raw = (this.getPath() || this.opts.defaultPath || DEFAULT_PATH).trim();
		return normalizePath(raw.replace(/\.[^./]+$/, "") + ".md");
	}

	/** The pre-1.5.6 `.json` location, for one-time migration. */
	legacyJsonPath(): string {
		return this.path().replace(/\.md$/i, ".json");
	}

	isDirectivesPath(path: string): boolean {
		return normalizePath(path) === this.path();
	}

	/** Load from the Markdown file. Returns true if the file existed. */
	async load(): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(this.path());
		if (!(file instanceof TFile)) return false;
		try {
			const raw = await this.app.vault.read(file);
			this.lastSerialized = raw;
			this.items = parseTodos(raw);
		} catch (e) {
			console.error("dash-core: could not read the directives file", e);
		}
		return true;
	}

	/** Migrate from the old `.json` file if it exists. Returns true if migrated. */
	async loadLegacyJson(): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(this.legacyJsonPath());
		if (!(file instanceof TFile)) return false;
		try {
			const raw = await this.app.vault.read(file);
			this.items = parseTodos(raw);
			this.lastSerialized = ""; // force a write to the new .md on next save
			return true;
		} catch (e) {
			console.error("dash-core: could not read the legacy directives file", e);
			return false;
		}
	}

	/** Write the current list to the Markdown file (creating it and its folder if
	 * needed). No-op when the content is unchanged. */
	async save(): Promise<void> {
		const body = buildMarkdown(this.items, this.opts.header);
		if (body === this.lastSerialized) return;
		this.lastSerialized = body;
		const path = this.path();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, body);
		} else {
			await this.ensureFolder(path);
			await this.app.vault.create(path, body);
		}
	}

	/** React to a vault change on the directives file (e.g. Obsidian Sync landing
	 * the other device's edit). Returns true if the in-memory list actually
	 * changed — our own writes reload to identical content and return false. */
	async onExternalChange(path: string): Promise<boolean> {
		if (!this.isDirectivesPath(path)) return false;
		const before = this.lastSerialized;
		await this.load();
		return this.lastSerialized !== before;
	}

	private async ensureFolder(path: string): Promise<void> {
		const dir = path.split("/").slice(0, -1).join("/");
		if (!dir) return;
		if (this.app.vault.getAbstractFileByPath(dir) instanceof TFolder) return;
		await this.app.vault.createFolder(dir).catch(() => {});
	}
}
