import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { LocalEvent } from "./localevents";
import type { LocalEventsStore } from "../panels/localeventmodal";
import { buildLocalEventsMarkdown, tryParseLocalEvents, unionEventsById } from "./localeventsserde";

/**
 * Persistence for local (dashboard-only) events as a **Markdown vault file**.
 *
 * Why Markdown specifically — the exact rationale DirectivesStore documents:
 * local events are edited on both phone and desktop, so they must sync. Obsidian
 * Sync always syncs Markdown; a plugin's `data.json` only syncs with "installed
 * community plugins" enabled, and a plain `.json` vault file only with "Sync all
 * other file types" (off by default) — which is why events entered on one device
 * never appeared on the other. Storing them as JSON inside a `.md` file removes
 * that dependency entirely, and we reload live when the other device's copy
 * lands (`onExternalChange`).
 *
 * Implements the modal's `LocalEventsStore` CRUD, so it can be passed straight
 * to `LocalEventModal`. The JSON serialization lives in `localeventsserde.ts`
 * (Obsidian-free, unit-tested).
 */
const DEFAULT_PATH = "Dashboard/Local Events.md";

/** Host-supplied chrome that keeps core lore-free while letting each dashboard
 * preserve its own on-disk format and default location. */
export interface LocalEventsFileStoreOptions {
	/** Voiced header line written at the top of the file (parsing ignores it). */
	header?: string;
	/** Fallback path when `getPath()` returns empty. */
	defaultPath?: string;
}

export class LocalEventsFileStore implements LocalEventsStore {
	private events: LocalEvent[] = [];
	/** The exact text we last read from / wrote to disk, so a modify event
	 * caused by our own write reloads to identical content and is ignored. */
	private lastSerialized = "";
	/** Same sync-safety guards as DirectivesStore: don't clobber an unreadable or
	 * not-yet-loaded file, and never CREATE an empty one. */
	private unreadable = false;
	private everLoaded = false;

	constructor(
		private app: App,
		private getPath: () => string,
		private opts: LocalEventsFileStoreOptions = {}
	) {}

	getEvents(): LocalEvent[] {
		return this.events;
	}

	/** The Markdown file the events live in. Any configured extension is coerced
	 * to `.md` so the file always syncs. */
	path(): string {
		const raw = (this.getPath() || this.opts.defaultPath || DEFAULT_PATH).trim();
		return normalizePath(raw.replace(/\.[^./]+$/, "") + ".md");
	}

	isLocalEventsPath(path: string): boolean {
		return normalizePath(path) === this.path();
	}

	/** Load from the Markdown file. Returns true if the file existed. */
	async load(): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(this.path());
		if (!(file instanceof TFile)) return false;
		try {
			const raw = await this.app.vault.read(file);
			const res = tryParseLocalEvents(raw);
			if (res.ok) {
				// Union local-only additions before the first clean load; replace after.
				this.events = this.everLoaded ? res.events : unionEventsById(res.events, this.events);
				this.lastSerialized = raw;
				this.unreadable = false;
				this.everLoaded = true;
			} else {
				this.unreadable = true;
				console.error("dash-core: local-events file did not parse — preserving it and refusing to overwrite.");
			}
		} catch (e) {
			this.unreadable = true;
			console.error("dash-core: could not read the local-events file", e);
		}
		return true;
	}

	/** One-time migration seed from an in-memory array (e.g. events that used to
	 * live in the plugin's `data.json`). Writes the file out so subsequent loads
	 * find it. No-op for an empty array. */
	async seedFrom(events: LocalEvent[]): Promise<void> {
		if (events.length === 0) return;
		this.events = events.map((e) => ({ ...e }));
		this.lastSerialized = ""; // force the first write
		await this.save();
	}

	private genId(): string {
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

	// -------- LocalEventsStore CRUD (each persists immediately) --------

	async add(patch: Omit<LocalEvent, "id">): Promise<void> {
		this.events.push({ id: this.genId(), ...patch });
		await this.save();
	}

	async update(id: string, patch: Omit<LocalEvent, "id">): Promise<void> {
		const ev = this.events.find((e) => e.id === id);
		if (!ev) return;
		Object.assign(ev, patch);
		await this.save();
	}

	async remove(id: string): Promise<void> {
		this.events = this.events.filter((e) => e.id !== id);
		await this.save();
	}

	/** Write the current events to the Markdown file (creating it and its folder
	 * if needed). No-op when the content is unchanged. */
	async save(): Promise<void> {
		if (this.unreadable) return; // don't overwrite a file we couldn't read
		if (!this.everLoaded) {
			// The real file may exist but not have loaded yet (sync lag). Re-check:
			// union if it's there, back off if it's there-but-unparsable.
			const existing = this.app.vault.getAbstractFileByPath(this.path());
			if (existing instanceof TFile) {
				try {
					const res = tryParseLocalEvents(await this.app.vault.read(existing));
					if (res.ok) this.events = unionEventsById(res.events, this.events);
					else {
						this.unreadable = true;
						return;
					}
				} catch {
					return;
				}
			}
		}
		const body = buildLocalEventsMarkdown(this.events, this.opts.header);
		if (body === this.lastSerialized) return;
		const path = this.path();
		const existing = this.app.vault.getAbstractFileByPath(path);
		// Never CREATE the file with an empty list — an empty file only arises from
		// clearing an already-existing one (a modify), so no startup/sync-lag path can
		// originate the empty file that would propagate as "events cleared".
		if (!(existing instanceof TFile) && this.events.length === 0) return;
		this.lastSerialized = body;
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, body);
		} else {
			await this.ensureFolder(path);
			await this.app.vault.create(path, body);
		}
		this.everLoaded = true;
	}

	/** React to a vault change on the events file (e.g. Obsidian Sync landing the
	 * other device's edit). Returns true if the in-memory list actually changed —
	 * our own writes reload to identical content and return false. */
	async onExternalChange(path: string): Promise<boolean> {
		if (!this.isLocalEventsPath(path)) return false;
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
