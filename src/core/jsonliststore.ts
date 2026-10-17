import { App, TFile, TFolder, normalizePath } from "obsidian";
import { buildListMarkdown, tryParseList, unionRecordsById } from "./jsonlistserde";

/**
 * Generic persistence for a list of `{ id }` records as a **Markdown vault file**,
 * carrying the sync-safety guards that made the directives reliable, so any
 * feature gets a cross-device list for free:
 *
 *  - Markdown always syncs via Obsidian Sync (unlike plugin data.json).
 *  - Never CREATE the file with an empty list — an empty file only ever arises
 *    from clearing an already-existing one, so no startup/sync-lag path can
 *    originate the empty file that would propagate as "everything cleared".
 *  - Before the first clean load, UNION local additions with the on-disk list
 *    instead of replacing — a not-yet-synced file can't be clobbered by an edit
 *    made before it landed.
 *  - Never overwrite a file we couldn't parse (corrupt / mid-sync): preserve it.
 *  - Heal an empty/broken file from memory or a per-device backup, and rewrite a
 *    recovered (smart-quote / merge-damaged) file back to clean canonical form.
 *
 * The record type is opaque here; the host supplies a validity predicate.
 */
export interface JsonListStoreOptions<T extends { id: string }> {
	/** Voiced header line written at the top of the file (parsing ignores it). */
	header: string;
	/** Fallback path when `getPath()` returns empty. */
	defaultPath: string;
	/** Drops malformed entries on read. Defaults to "object with a string id". */
	isValid?: (r: unknown) => r is T;
	/** Optional per-device backup of the last non-empty list (host-persisted, e.g.
	 * in data.json), used to heal a file found empty/broken on a device that has
	 * held real records — even on a cold start with nothing in memory. */
	getBackup?: () => T[];
	setBackup?: (records: T[]) => void;
}

export class JsonListStore<T extends { id: string }> {
	private records: T[] = [];
	private lastSerialized = "";
	private unreadable = false;
	private everLoaded = false;
	/** True while we're writing the file. Our own write fires a vault "modify"
	 * event; reacting to it (reloading) mid-write can clobber in-memory records
	 * that are ahead of disk during a burst of saves. Skip external-change handling
	 * while this is set. */
	private writing = false;

	constructor(
		private app: App,
		private getPath: () => string,
		private opts: JsonListStoreOptions<T>
	) {}

	getAll(): T[] {
		return this.records;
	}
	setAll(records: T[]): void {
		this.records = records;
	}
	hasLoaded(): boolean {
		return this.everLoaded;
	}
	isUnreadable(): boolean {
		return this.unreadable;
	}
	lastStatus = "not loaded yet";

	/** The Markdown file the records live in. Any extension is coerced to `.md`. */
	path(): string {
		const raw = (this.getPath() || this.opts.defaultPath).trim();
		return normalizePath(raw.replace(/\.[^./]+$/, "") + ".md");
	}

	isStorePath(path: string): boolean {
		return normalizePath(path) === this.path();
	}

	/** Load from the Markdown file. Returns true if the file existed. Heals a file
	 * found empty OR unparseable when this device holds a known-good list (memory or
	 * backup), and rewrites a recovered file clean. */
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
			console.error("dash-core: could not read", path, e);
			return true;
		}
		const res = tryParseList<T>(raw, this.opts.isValid);
		const emptyOrBroken = !res.ok || res.records.length === 0;
		if (emptyOrBroken) {
			const restore = this.records.length > 0 ? this.records : this.opts.getBackup?.() ?? [];
			if (restore.length > 0) {
				console.warn(`dash-core: ${path} ${res.ok ? "was empty" : "did not parse"} but this device holds a real list — healing it (${restore.length}).`);
				this.records = restore.map((r) => ({ ...r }));
				this.unreadable = false;
				this.everLoaded = true;
				this.opts.setBackup?.(this.records);
				this.lastSerialized = "";
				await this.save();
				this.lastStatus = `healed ${res.ok ? "empty" : "unparseable"} file → ${this.records.length}`;
				return true;
			}
			if (!res.ok) {
				this.unreadable = true;
				this.lastStatus = `unparseable file at "${path}" (${raw.length} bytes), no backup to heal from`;
				console.error("dash-core: file did not parse — preserving it and refusing to overwrite:", path);
				return true;
			}
			// Genuinely empty on a device that has never held a list — accept it.
		}
		this.records = this.everLoaded ? res.records : unionRecordsById(res.records, this.records);
		this.lastSerialized = raw;
		this.unreadable = false;
		this.everLoaded = true;
		if (this.records.length > 0) this.opts.setBackup?.(this.records);
		this.lastStatus = `loaded ${this.records.length} from "${path}"`;
		if (res.recovered && this.records.length > 0) {
			console.warn("dash-core: recovered a mangled file — rewriting clean:", path);
			this.lastSerialized = "";
			await this.save();
			this.lastStatus = `recovered + healed → ${this.records.length}`;
		}
		return true;
	}

	/** Seed from an in-memory array (e.g. a one-time migration). Writes the file
	 * out. No-op for an empty array. */
	async seedFrom(records: T[]): Promise<void> {
		if (records.length === 0) return;
		this.records = records.map((r) => ({ ...r }));
		this.lastSerialized = "";
		await this.save();
	}

	/** Write the current records. No-op when unchanged. Never creates an empty
	 * file; refuses while unreadable; unions if the real file appears before the
	 * first load. */
	async save(): Promise<void> {
		if (this.unreadable) {
			console.warn("dash-core: skipping save — last read was unreadable (protecting the file):", this.path());
			return;
		}
		this.writing = true;
		try {
			if (!this.everLoaded) {
				const existing = this.app.vault.getAbstractFileByPath(this.path());
				if (existing instanceof TFile) {
					try {
						const res = tryParseList<T>(await this.app.vault.read(existing), this.opts.isValid);
						if (res.ok) this.records = unionRecordsById(res.records, this.records);
						else {
							this.unreadable = true;
							console.warn("dash-core: file appeared but didn't parse on save — preserving it:", this.path());
							return;
						}
					} catch (e) {
						console.error("dash-core: could not re-read before save — preserving the file:", this.path(), e);
						return;
					}
				}
			}
			const body = buildListMarkdown(this.records, this.opts.header);
			if (body === this.lastSerialized) return;
			const path = this.path();
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (!(existing instanceof TFile) && this.records.length === 0) return; // never create empty
			this.lastSerialized = body;
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, body);
			} else {
				await this.ensureFolder(path);
				await this.app.vault.create(path, body);
			}
			this.everLoaded = true;
			this.opts.setBackup?.(this.records);
		} finally {
			this.writing = false;
		}
	}

	/** React to a vault change on the file (Sync landing another device's edit).
	 * Returns true if the in-memory list actually changed. */
	async onExternalChange(path: string): Promise<boolean> {
		if (!this.isStorePath(path)) return false;
		// Ignore the "modify" event our own write just fired — reloading now could
		// read a stale/mid-burst state and clobber in-memory records that are ahead
		// of disk. A genuine external (Sync) change will fire again once we're idle.
		if (this.writing) return false;
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
