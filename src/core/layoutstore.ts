import { App, TFile, TFolder, normalizePath } from "obsidian";
import { DashLayout, buildLayoutMarkdown, layoutHasContent, tryParseLayout } from "./layoutserde";

/**
 * Persistence for the dashboard layout (mobile tabs + card assignments + default
 * tab + the mobile-tabs toggle, plus panel order/enable/columns/spans) as a
 * **Markdown vault file**, so it syncs via Obsidian Sync's always-on Markdown
 * channel instead of the plugin `data.json` — which this vault has repeatedly
 * shown does not reliably survive updates or cross devices. Same rationale and
 * guards as AICredsStore / DirectivesStore / LocalEventsFileStore.
 *
 * The synced file is authoritative when present (it repopulates a device whose
 * data.json arrived empty on update — the exact "tabs reverted" bug). `data.json`
 * keeps a copy as the always-present local fallback, so the layout can never be
 * the sole, losable copy. The store never ORIGINATES a file for a user with no
 * layout content (nothing to preserve, and an empty file could clobber a device
 * that did have a config); a deliberate settings edit writes regardless.
 */
const DEFAULT_PATH = "MERIDIAN/Dashboard Layout.md";

export interface LayoutStoreOptions {
	header?: string;
	defaultPath?: string;
}

export class LayoutStore {
	private layout: DashLayout = {};
	/** Exact text last read/written, so our own writes reload to identical content. */
	private lastSerialized = "";
	/** File exists but didn't parse (corrupt / mid-sync) — never overwrite while set. */
	private unreadable = false;
	/** True once a real file has been read (or written) this session. */
	private everLoaded = false;

	constructor(
		private app: App,
		private getPath: () => string,
		private opts: LayoutStoreOptions = {}
	) {}

	get(): DashLayout {
		return this.layout;
	}
	hasLoaded(): boolean {
		return this.everLoaded;
	}

	/** The Markdown file the layout lives in. Any extension is coerced to `.md`
	 * so the file always syncs. */
	path(): string {
		const raw = (this.getPath() || this.opts.defaultPath || DEFAULT_PATH).trim();
		return normalizePath(raw.replace(/\.[^./]+$/, "") + ".md");
	}

	isLayoutPath(path: string): boolean {
		return normalizePath(path) === this.path();
	}

	/** Load from the Markdown file. Returns true if the file existed. */
	async load(): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(this.path());
		if (!(file instanceof TFile)) return false;
		try {
			const raw = await this.app.vault.read(file);
			const res = tryParseLayout(raw);
			if (res.ok) {
				this.layout = res.layout;
				this.lastSerialized = raw;
				this.unreadable = false;
				this.everLoaded = true;
			} else {
				this.unreadable = true;
				console.error("dash-core: dashboard layout file did not parse — preserving it and refusing to overwrite.");
			}
		} catch (e) {
			this.unreadable = true;
			console.error("dash-core: could not read the dashboard layout file", e);
		}
		return true;
	}

	/** One-time migration seed from the layout that used to live in `data.json`.
	 * Writes the file only when there's real layout content and no synced file has
	 * landed yet — so an existing device's config becomes the synced source of
	 * truth without ever originating an empty file. */
	async seedFrom(layout: DashLayout): Promise<void> {
		if (!layoutHasContent(layout)) return;
		if (this.everLoaded && layoutHasContent(this.layout)) return; // a synced layout already won
		// If a real file is already on disk, let load() adopt it rather than clobber.
		if (this.app.vault.getAbstractFileByPath(this.path()) instanceof TFile) {
			await this.load();
			if (layoutHasContent(this.layout)) return;
		}
		this.layout = layout;
		this.lastSerialized = "";
		await this.writeFile(true);
	}

	/** A deliberate user edit in settings. Persists whatever the layout now is —
	 * creating the file if needed (the user is actively configuring the layout, so
	 * the synced file should exist from here on). */
	async setFromSettings(layout: DashLayout): Promise<void> {
		this.layout = layout;
		this.unreadable = false; // the user is authoritatively setting it now
		this.lastSerialized = "";
		await this.writeFile(true);
	}

	/** React to a vault change on the layout file (Sync landing another device's
	 * edit). Returns true if the in-memory layout actually changed. */
	async onExternalChange(path: string): Promise<boolean> {
		if (!this.isLayoutPath(path)) return false;
		const before = this.lastSerialized;
		await this.load();
		return this.lastSerialized !== before;
	}

	/** Write the current layout out. No-op when unchanged. Refuses while the file
	 * is unreadable. When `create` is false, never mints a missing file. */
	private async writeFile(create: boolean): Promise<void> {
		if (this.unreadable) return;
		const body = buildLayoutMarkdown(this.layout, this.opts.header);
		if (body === this.lastSerialized) return;
		const path = this.path();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!(existing instanceof TFile) && !create) return;
		this.lastSerialized = body;
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, body);
		} else {
			await this.ensureFolder(path);
			await this.app.vault.create(path, body);
		}
		this.everLoaded = true;
	}

	private async ensureFolder(path: string): Promise<void> {
		const dir = path.split("/").slice(0, -1).join("/");
		if (!dir) return;
		if (this.app.vault.getAbstractFileByPath(dir) instanceof TFolder) return;
		await this.app.vault.createFolder(dir).catch(() => {});
	}
}
