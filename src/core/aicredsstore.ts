import { App, TFile, TFolder, normalizePath } from "obsidian";
import { AICredentials, buildAICredsMarkdown, tryParseAICreds } from "./aicredsserde";

/**
 * Persistence for the AI credentials (API key + optional base URL) as a
 * **Markdown vault file**, so the key syncs via Obsidian Sync's always-on
 * Markdown channel instead of the plugin `data.json` — which this vault has
 * repeatedly shown does not reliably cross devices even with community-plugin
 * sync enabled. Same rationale and guards as DirectivesStore / LocalEventsFileStore.
 *
 * Secret-specific rule: an EMPTY key never overwrites a non-empty one through an
 * automatic path (startup, sync-lag re-save, migration). Only a deliberate user
 * edit in settings (`setFromSettings`) may clear an existing file's key — exactly
 * as clearing the directives is the one way an empty list reaches disk.
 */
const DEFAULT_PATH = "MERIDIAN/AI Credentials.md";

export interface AICredsStoreOptions {
	header?: string;
	defaultPath?: string;
}

export class AICredsStore {
	private creds: AICredentials = { apiKey: "" };
	/** Exact text last read/written, so our own writes reload to identical content. */
	private lastSerialized = "";
	/** File exists but didn't parse (corrupt / mid-sync) — never overwrite while set. */
	private unreadable = false;
	/** True once a real file has been read (or written) this session. */
	private everLoaded = false;

	constructor(
		private app: App,
		private getPath: () => string,
		private opts: AICredsStoreOptions = {}
	) {}

	get(): AICredentials {
		return this.creds;
	}
	getApiKey(): string {
		return this.creds.apiKey ?? "";
	}
	getBaseUrl(): string | undefined {
		return this.creds.baseUrl;
	}
	hasLoaded(): boolean {
		return this.everLoaded;
	}

	/** The Markdown file the credentials live in. Any extension is coerced to `.md`
	 * so the file always syncs. */
	path(): string {
		const raw = (this.getPath() || this.opts.defaultPath || DEFAULT_PATH).trim();
		return normalizePath(raw.replace(/\.[^./]+$/, "") + ".md");
	}

	isCredsPath(path: string): boolean {
		return normalizePath(path) === this.path();
	}

	/** Load from the Markdown file. Returns true if the file existed. An empty key
	 * in the file is a legitimate state (the user cleared it on another device). */
	async load(): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(this.path());
		if (!(file instanceof TFile)) return false;
		try {
			const raw = await this.app.vault.read(file);
			const res = tryParseAICreds(raw);
			if (res.ok) {
				this.creds = res.creds;
				this.lastSerialized = raw;
				this.unreadable = false;
				this.everLoaded = true;
			} else {
				this.unreadable = true;
				console.error("dash-core: AI credentials file did not parse — preserving it and refusing to overwrite.");
			}
		} catch (e) {
			this.unreadable = true;
			console.error("dash-core: could not read the AI credentials file", e);
		}
		return true;
	}

	/** One-time migration seed from the key that used to live in `data.json`.
	 * Writes the file only when there's a real key and no synced file has landed
	 * yet — so an existing device's key becomes the synced source of truth without
	 * ever originating an empty file. */
	async seedFrom(apiKey: string, baseUrl?: string): Promise<void> {
		if (!apiKey) return;
		if (this.everLoaded && this.creds.apiKey) return; // a synced key already won
		// If a real file is already on disk, let load() adopt it rather than clobber.
		if (this.app.vault.getAbstractFileByPath(this.path()) instanceof TFile) {
			await this.load();
			if (this.creds.apiKey) return;
		}
		this.creds = { apiKey, baseUrl: baseUrl || undefined };
		this.lastSerialized = "";
		await this.writeFile();
	}

	/** A deliberate user edit in settings. Persists whatever the user typed —
	 * INCLUDING an empty key to clear it — but still never CREATES the file for an
	 * empty key (nothing to store, and an auto/startup path must never mint one). */
	async setFromSettings(apiKey: string, baseUrl?: string): Promise<void> {
		this.creds = { apiKey: apiKey ?? "", baseUrl: baseUrl || undefined };
		const existing = this.app.vault.getAbstractFileByPath(this.path());
		if (!(existing instanceof TFile) && !this.creds.apiKey) {
			this.lastSerialized = "";
			return;
		}
		this.unreadable = false; // the user is authoritatively setting it now
		this.lastSerialized = "";
		await this.writeFile();
	}

	/** React to a vault change on the credentials file (Sync landing another
	 * device's edit). Returns true if the in-memory key actually changed. */
	async onExternalChange(path: string): Promise<boolean> {
		if (!this.isCredsPath(path)) return false;
		const before = this.lastSerialized;
		await this.load();
		return this.lastSerialized !== before;
	}

	/** Write the current credentials out. No-op when unchanged. Never creates the
	 * file for an empty key; refuses while the file is unreadable. */
	private async writeFile(): Promise<void> {
		if (this.unreadable) return;
		const body = buildAICredsMarkdown(this.creds, this.opts.header);
		if (body === this.lastSerialized) return;
		const path = this.path();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!(existing instanceof TFile) && !this.creds.apiKey) return;
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
