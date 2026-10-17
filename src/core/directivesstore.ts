import { App, TFile, TFolder, normalizePath } from "obsidian";
import { TodoItem } from "./todostore";
import { buildMarkdown, tryParseTodos, unionById } from "./directivesserde";

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
	/** Host-persisted flag: has this DEVICE ever successfully read the directives
	 * file (in any past session)? If so, a session where the file is momentarily
	 * absent means Sync hasn't delivered it yet — not a fresh vault — so we must
	 * refuse to create/overwrite it and clobber the copy that's syncing in. */
	hasSeenFile?: () => boolean;
	/** Record that this device has now seen the file (persist across sessions). */
	markSeenFile?: () => void;
	/** Host-persisted backup of the last non-empty list (per device, in data.json).
	 * Used to heal the file if it is ever found empty on a device that has seen a
	 * real list — even on a cold start with nothing in memory yet. */
	getBackup?: () => TodoItem[];
	setBackup?: (items: TodoItem[]) => void;
}

export class DirectivesStore {
	private items: TodoItem[] = [];
	/** The exact text we last read from / wrote to disk, so a modify event
	 * caused by our own write reloads to identical content and is ignored. */
	private lastSerialized = "";
	/** True when the file exists but didn't parse (corrupt / mid-sync). While set,
	 * we never overwrite it — protecting the on-disk list from being clobbered by
	 * an accidental empty save. Cleared on the next successful read. */
	private unreadable = false;
	/** True once we have actually READ an existing on-disk file (or created a fresh
	 * one). Until then a save must not blindly overwrite: on a secondary device the
	 * real file may simply not have synced into the vault index yet, and writing our
	 * (empty / just-added) list would clobber it once Sync lands it. See `save()`. */
	private everLoaded = false;
	/** Until this timestamp, refuse to CREATE the file when it's absent — a fresh
	 * install and a still-downloading synced vault are indistinguishable at startup,
	 * so we give Sync a window to deliver the real file before we'd mint a rival
	 * (empty/just-added) copy that clobbers it. Set by the host on a fileless start. */
	private graceUntil = 0;

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

	/** Whether an on-disk file has been read this session. */
	hasLoaded(): boolean {
		return this.everLoaded;
	}

	/** Defer CREATING the file for `ms` when it's absent at startup, so a syncing
	 * copy can land first. No effect once the file has loaded. */
	deferCreateFor(ms: number): void {
		this.graceUntil = Date.now() + ms;
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

	/** Last load outcome, for the diagnostics command. */
	lastStatus = "not loaded yet";

	/** Load from the Markdown file. Returns true if the file existed. Heals a file
	 * that is empty OR unparseable when this device has a known-good list to restore
	 * from (memory this session, or the persisted per-device backup) — so a wipe or
	 * a corrupting reformat can't erase the list; it is rewritten intact. */
	async load(): Promise<boolean> {
		const path = this.path();
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			this.lastStatus = `no file at "${path}"`;
			return false;
		}
		let raw: string;
		try {
			raw = await this.app.vault.read(file);
		} catch (e) {
			this.unreadable = true;
			this.lastStatus = `read error at "${path}": ${(e as Error).message}`;
			console.error("dash-core: could not read the directives file", e);
			return true;
		}
		const res = tryParseTodos(raw);
		const emptyOrBroken = !res.ok || res.todos.length === 0;
		if (emptyOrBroken) {
			// The file is empty or won't parse. If this device has ever held a real
			// list, that is a wipe or a corrupting reformat — NOT a genuine clear.
			// Restore from the best source and rewrite the file intact. A brand-new
			// vault that has never held a list has neither source and accepts it.
			const restore = this.items.length > 0 ? this.items : this.opts.getBackup?.() ?? [];
			const seenReal = this.everLoaded || !!this.opts.hasSeenFile?.();
			if (restore.length > 0 && seenReal) {
				console.warn(`dash-core: directives file ${res.ok ? "was empty" : "did not parse"} but this device holds a real list — healing it (${restore.length} items).`);
				this.items = restore.map((t) => ({ ...t }));
				this.unreadable = false;
				this.everLoaded = true;
				this.opts.markSeenFile?.();
				this.opts.setBackup?.(this.items);
				this.lastSerialized = ""; // force save() to rewrite
				await this.save();
				this.lastStatus = `healed ${res.ok ? "empty" : "unparseable"} file → ${this.items.length} items`;
				return true;
			}
			if (!res.ok) {
				// No good source to heal from — preserve the file and don't overwrite.
				this.unreadable = true;
				this.lastStatus = `unparseable file at "${path}" (${raw.length} bytes), no backup to heal from`;
				console.error("dash-core: directives file did not parse — preserving it and refusing to overwrite.");
				return true;
			}
			// Genuinely empty on a device that has never held a list — accept it.
		}
		// Normal readable content. Union session-local adds before the first clean
		// load; replace afterward so another device's edits propagate.
		this.items = this.everLoaded ? res.todos : unionById(res.todos, this.items);
		this.lastSerialized = raw;
		this.unreadable = false;
		this.everLoaded = true;
		this.opts.markSeenFile?.();
		if (this.items.length > 0) this.opts.setBackup?.(this.items);
		this.lastStatus = `loaded ${this.items.length} items from "${path}"`;
		// The list parsed only after recovery (a mangled fence / smart quotes) — the
		// on-disk file is non-canonical. Rewrite it clean so it parses normally next
		// time (and any smart-punctuation damage is undone).
		if (res.recovered && this.items.length > 0) {
			console.warn("dash-core: recovered a mangled directives file — rewriting it in clean canonical form.");
			this.lastSerialized = "";
			await this.save();
			this.lastStatus = `recovered + healed → ${this.items.length} items`;
		}
		return true;
	}

	/** If we still haven't loaded a file and none exists on disk, but this device
	 * has a non-empty backup, recreate the file from it. Covers a directives file
	 * that was deleted or moved out from under us. Returns true if it recreated. */
	async ensureFromBackup(): Promise<boolean> {
		if (this.everLoaded) return false;
		if (this.app.vault.getAbstractFileByPath(this.path()) instanceof TFile) return false;
		const backup = this.opts.getBackup?.() ?? [];
		if (backup.length === 0) return false;
		console.warn(`dash-core: no directives file on disk — recreating from backup (${backup.length} items).`);
		this.items = backup.map((t) => ({ ...t }));
		await this.save();
		this.lastStatus = `recreated file from backup → ${this.items.length} items`;
		return true;
	}

	/** Whether the store is currently protecting an unreadable file. */
	isUnreadable(): boolean {
		return this.unreadable;
	}

	/** Migrate from the old `.json` file if it exists. Returns true if migrated. */
	async loadLegacyJson(): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(this.legacyJsonPath());
		if (!(file instanceof TFile)) return false;
		try {
			const raw = await this.app.vault.read(file);
			const res = tryParseTodos(raw);
			if (!res.ok) return false; // don't migrate from an unreadable legacy file
			this.items = res.todos;
			this.everLoaded = true; // we read a real (legacy) file; safe to write forward
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
		// Never overwrite a file we couldn't read — that's how a corrupt/mid-sync
		// file would get replaced with an empty list and the reminders lost.
		if (this.unreadable) {
			console.warn("dash-core: skipping directives save — last read was unreadable (protecting the file).");
			return;
		}
		// If we have never actually read the on-disk file, it may exist but simply
		// not have synced into the vault index when we first looked (common on a
		// secondary device / iPhone). Writing our list now would clobber it. Re-check
		// the disk: if the real file is there, load and UNION it with our in-memory
		// items (all edits made against an unloaded list can only be additions), so
		// the on-disk reminders are preserved and any new one is appended.
		if (!this.everLoaded) {
			const existing = this.app.vault.getAbstractFileByPath(this.path());
			if (existing instanceof TFile) {
				try {
					const res = tryParseTodos(await this.app.vault.read(existing));
					if (res.ok) this.items = unionById(res.todos, this.items);
					else {
						// The file is there but unreadable right now — do not risk it.
						this.unreadable = true;
						console.warn("dash-core: directives file appeared but didn't parse on save — preserving it.");
						return;
					}
				} catch (e) {
					console.error("dash-core: could not re-read directives before save — preserving the file.", e);
					return;
				}
			} else if (this.opts.hasSeenFile?.() || Date.now() < this.graceUntil) {
				// No file on disk. Either this device has read it before (so its absence
				// means Sync just hasn't delivered it yet), or we're still inside the
				// startup grace window (fresh vault and still-downloading vault look
				// identical here). Creating now would mint a rival copy and clobber the
				// real one when it lands. Refuse — our in-memory additions are held and
				// written once the file loads, or once the grace window has elapsed with
				// no file (a genuinely fresh vault), whichever comes first.
				console.warn("dash-core: directives file not present yet — deferring create to protect a possibly-syncing copy.");
				return;
			}
			// (everLoaded/markSeenFile are set only after an actual write, below.)
		}
		const body = buildMarkdown(this.items, this.opts.header);
		if (body === this.lastSerialized) return;
		const path = this.path();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!(existing instanceof TFile) && this.items.length === 0) {
			// Never CREATE the directives file with an empty list. An empty list only
			// ever legitimately arises from the user clearing a list that already
			// existed on disk (a modify, below). This one rule makes it impossible for
			// any startup / sync-lag / grace path to originate the empty file that then
			// propagates across devices as a "cleared" to-do list. A fresh vault stays
			// file-less until the first real item is added.
			return;
		}
		this.lastSerialized = body;
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, body);
		} else {
			await this.ensureFolder(path);
			await this.app.vault.create(path, body);
		}
		// We now hold an authoritative on-disk file (created or reconciled): future
		// loads may replace rather than union, and this device has "seen" the file.
		this.everLoaded = true;
		this.opts.markSeenFile?.();
		// Mirror exactly what we just wrote. A non-empty write refreshes the backup;
		// the ONLY way an empty list reaches this point is the user deliberately
		// clearing an existing file (external wipes are healed in load() before any
		// save), so clearing the backup here lets a genuine clear-all stick.
		this.opts.setBackup?.(this.items);
	}

	/** React to a vault change on the directives file (e.g. Obsidian Sync landing
	 * the other device's edit). Returns true if the in-memory list actually
	 * changed — our own writes reload to identical content and return false. */
	async onExternalChange(path: string): Promise<boolean> {
		if (!this.isDirectivesPath(path)) return false;
		const before = this.lastSerialized;
		// load() itself heals a catastrophic empty (restores + rewrites), so an
		// external wipe landing here is repaired rather than accepted.
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
