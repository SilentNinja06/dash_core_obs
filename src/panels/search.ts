import { TFile, prepareFuzzySearch } from "obsidian";
import { BasePanel, placard } from "./types";
import { LibraryStore } from "../core/library";
import { NewCategoryModal, NewNoteModal, runAssignFlow } from "./categorymodals";

/**
 * Knowledge-base search. Fuzzy search scoped to the configured folder only. Uses
 * Obsidian's `prepareFuzzySearch` over filenames and headings (read from the
 * metadata cache, so it stays instant on mobile). Enter opens; arrow keys
 * navigate on desktop. The library store is injected by the host.
 */
interface Candidate {
	file: TFile;
	basename: string;
	headings: string[];
	mtime: number;
	size: number;
}

interface Hit {
	file: TFile;
	title: string;
	context: string;
	score: number;
	/** True for a body-text match — ranked below filename/heading hits. */
	body: boolean;
}

/** Skip scanning bodies larger than this (bytes) — the perf guard. */
const BODY_SCAN_CAP = 100_000;

export class SearchPanel extends BasePanel {
	id = "search";
	title = "Knowledge Base";
	private index: Candidate[] = [];
	private selected = 0;
	private hits: Hit[] = [];
	private resultsEl?: HTMLElement;
	private inputEl?: HTMLInputElement;
	private debounce: number | null = null;
	/** Bumped per query so a slow body scan from a stale query is discarded. */
	private queryToken = 0;
	private showingRecent = true;

	constructor(private store: LibraryStore) {
		super();
	}

	protected async setup(): Promise<void> {
		this.buildIndex();
		this.onCleanup(() => {
			if (this.debounce !== null) window.clearTimeout(this.debounce);
		});
	}

	private buildIndex(): void {
		const s = this.ctx.settings();
		const paths = (s.kbSearchPaths && s.kbSearchPaths.length ? s.kbSearchPaths : [s.kbSearchPath ?? ""])
			.map(normalizeFolder)
			.filter((p) => p);
		this.index = [];
		for (const file of this.ctx.app.vault.getMarkdownFiles()) {
			if (paths.length && !paths.some((p) => file.path.startsWith(p))) continue;
			const cache = this.ctx.app.metadataCache.getFileCache(file);
			const headings = (cache?.headings ?? []).map((h) => h.heading);
			this.index.push({ file, basename: file.basename, headings, mtime: file.stat.mtime, size: file.stat.size });
		}
	}

	protected renderBody(): void {
		this.buildIndex();
		placard(this.el, "Knowledge Base");

		// Notes + category management.
		const store = this.store;
		const actions = this.el.createDiv({ cls: "dash-btn-row" });
		const note = actions.createEl("button", { cls: "dash-btn dash-btn-primary", text: "+ Note" });
		note.addEventListener("click", () => new NewNoteModal(this.ctx.app, store, () => this.rerender()).open());
		const cat = actions.createEl("button", { cls: "dash-btn", text: "+ Category" });
		cat.addEventListener("click", () => new NewCategoryModal(this.ctx.app, store, () => this.rerender()).open());
		const assign = actions.createEl("button", { cls: "dash-btn", text: "Assign to category" });
		assign.addEventListener("click", () => runAssignFlow(this.ctx.app, store, () => this.rerender()));

		const input = this.el.createEl("input", {
			cls: "dash-search-input",
			attr: { type: "search", placeholder: "Search the knowledge base…", enterkeyhint: "search" },
		});
		this.inputEl = input;
		this.resultsEl = this.el.createDiv({ cls: "dash-search-results" });

		input.addEventListener("input", () => this.scheduleQuery(input.value));
		input.addEventListener("keydown", (e) => this.onKey(e));
		void this.runQuery("");

		this.renderCategories();
	}

	/** Debounce body-scanning input ~150ms; empty query resolves immediately. */
	private scheduleQuery(query: string): void {
		if (this.debounce !== null) window.clearTimeout(this.debounce);
		if (!query.trim()) {
			void this.runQuery(query);
			return;
		}
		this.debounce = window.setTimeout(() => {
			this.debounce = null;
			void this.runQuery(query);
		}, 150);
	}

	private renderCategories(): void {
		const store = this.store;
		const cats = store.listCategories();
		const section = this.el.createDiv({ cls: "dash-sb-cats" });
		section.createDiv({ cls: "dash-subhead", text: `Categories · ${cats.length}` });
		if (cats.length === 0) {
			section.createDiv({ cls: "dash-muted", text: "No categories yet. Create one to start organizing." });
			return;
		}
		const listEl = section.createDiv();
		// Read every category's members up front so the counts show immediately
		// (cachedRead is memory-cached, so this is cheap on subsequent renders).
		void (async () => {
			const withMembers = await Promise.all(
				cats.map(async (c) => ({ cat: c, members: await store.categoryMembers(c.file) }))
			);
			if (!listEl.isConnected) return;
			for (const { cat, members } of withMembers) {
				const details = listEl.createEl("details", { cls: "dash-sb-cat" });
				const summary = details.createEl("summary");
				summary.createSpan({ cls: "dash-sb-cat-name", text: cat.name });
				summary.createSpan({ cls: "dash-chip dash-chip-cold", text: String(members.length) });
				const body = details.createDiv({ cls: "dash-sb-cat-body" });
				if (members.length === 0) body.createDiv({ cls: "dash-muted", text: "Empty." });
				for (const m of members) {
					const row = body.createDiv({ cls: "dash-sb-member" });
					const link = row.createEl("a", { cls: "dash-sb-link", text: m });
					link.addEventListener("click", (e) => {
						e.preventDefault();
						void this.ctx.app.workspace.openLinkText(m, cat.file.path, false);
					});
				}
			}
		})();
	}

	private async runQuery(query: string): Promise<void> {
		const q = query.trim();
		const token = ++this.queryToken;
		this.selected = 0;

		if (!q) {
			// Empty query → the most-recently-modified notes in scope.
			this.showingRecent = true;
			const n = Math.max(0, this.ctx.settings().kbRecentCount ?? 8);
			this.hits = this.index
				.slice()
				.sort((a, b) => b.mtime - a.mtime)
				.slice(0, n)
				.map((c) => ({ file: c.file, title: c.basename, context: "", score: 0, body: false }));
			this.renderResults();
			return;
		}

		this.showingRecent = false;

		// Primary signal: filename + heading fuzzy match.
		const search = prepareFuzzySearch(q);
		const nameHits: Hit[] = [];
		for (const cand of this.index) {
			let best = search(cand.basename);
			let context = "";
			for (const h of cand.headings) {
				const r = search(h);
				if (r && (!best || r.score > best.score)) {
					best = r;
					context = h;
				}
			}
			if (best) nameHits.push({ file: cand.file, title: cand.basename, context, score: best.score, body: false });
		}
		nameHits.sort((a, b) => b.score - a.score);

		// Show the fast name/heading hits right away.
		this.hits = nameHits.slice(0, 20);
		this.renderResults();

		// Body-text pass behind the perf guard, ranked below name/heading hits.
		if (!this.ctx.settings().kbSearchBody) return;
		const already = new Set(nameHits.map((h) => h.file.path));
		const needle = q.toLowerCase();
		const bodyHits: Hit[] = [];
		for (const cand of this.index) {
			if (already.has(cand.file.path)) continue;
			if (cand.size > BODY_SCAN_CAP) continue;
			let content: string;
			try {
				content = await this.ctx.app.vault.cachedRead(cand.file);
			} catch {
				continue;
			}
			if (token !== this.queryToken) return; // a newer query superseded this scan
			const snippet = firstMatchingLine(content, needle);
			if (snippet) bodyHits.push({ file: cand.file, title: cand.basename, context: snippet, score: 0, body: true });
		}
		if (token !== this.queryToken) return;
		this.hits = [...nameHits, ...bodyHits].slice(0, 30);
		this.renderResults();
	}

	private renderResults(): void {
		const el = this.resultsEl;
		if (!el) return;
		el.empty();

		if (this.showingRecent) {
			if (this.hits.length === 0) {
				el.createDiv({ cls: "dash-muted", text: "No notes in the knowledge-base scope yet." });
				return;
			}
			el.createDiv({ cls: "dash-subhead", text: `Recently modified · ${this.hits.length}` });
		} else if (this.hits.length === 0) {
			el.createDiv({ cls: "dash-muted", text: "No matches in the knowledge base." });
			return;
		}

		this.hits.forEach((hit, i) => {
			const row = el.createDiv({ cls: "dash-search-row" });
			if (i === this.selected) row.addClass("is-selected");
			row.createDiv({ cls: "dash-search-title", text: hit.title });
			if (hit.context && hit.context !== hit.title) {
				const ctx = row.createDiv({ cls: "dash-search-context", text: hit.context });
				if (hit.body) ctx.addClass("is-body");
			}
			row.addEventListener("click", () => this.open(hit.file));
		});
	}

	private onKey(e: KeyboardEvent): void {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			this.selected = Math.min(this.hits.length - 1, this.selected + 1);
			this.renderResults();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			this.selected = Math.max(0, this.selected - 1);
			this.renderResults();
		} else if (e.key === "Enter") {
			e.preventDefault();
			const hit = this.hits[this.selected];
			if (hit) this.open(hit.file);
		}
	}

	private open(file: TFile): void {
		void this.ctx.app.workspace.getLeaf(false).openFile(file);
	}
}

function normalizeFolder(path: string): string {
	const p = path.trim().replace(/^\/+/, "");
	if (!p) return "";
	return p.endsWith("/") ? p : p + "/";
}

/** The first non-heading, non-blank line containing `needle` (lower-cased), for
 * the muted body-match snippet. Truncated so a long line stays one line. */
function firstMatchingLine(content: string, needle: string): string {
	for (const raw of content.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		if (line.toLowerCase().includes(needle)) {
			return line.length > 120 ? line.slice(0, 117) + "…" : line;
		}
	}
	return "";
}
