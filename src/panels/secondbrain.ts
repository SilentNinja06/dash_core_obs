import { App, Modal, Notice, Setting, TFile, prepareFuzzySearch } from "obsidian";
import { BasePanel, placard } from "./types";
import { LibraryStore } from "../core/library";

/**
 * Second Brain panel — an ongoing-project note library. Search it, add notes, and
 * delete / archive / unarchive them. The library store is injected by the host;
 * strings are neutral note-library chrome, overridable via {@link SecondBrainCopy}
 * (omitted → the neutral defaults below, so existing call sites are unchanged).
 * `{n}`/`{name}` are substituted where noted.
 */
export interface SecondBrainCopy {
	title: string;
	/** `{n} active` */
	activeBadge: string;
	newNote: string;
	searchPlaceholder: string;
	noMatches: string;
	noActiveNotes: string;
	/** `+{n} more — type to search.` */
	moreHint: string;
	archiveTooltip: string;
	deleteTooltip: string;
	unarchiveTooltip: string;
	/** `Archive · {n}` */
	archivedHeading: string;
	/** `Restored {name}.` */
	restoredNotice: string;
	/** `Archived {name}.` */
	archivedNotice: string;
	/** `Deleted {name}.` */
	deletedNotice: string;
	/** `Delete “{name}”?` */
	deleteHeading: string;
	deleteBody: string;
	cancel: string;
	deleteConfirm: string;
	newNoteTitle: string;
	noteTitleLabel: string;
	noteTitlePlaceholder: string;
	create: string;
	noteNeedsTitle: string;
}

export const DEFAULT_SECOND_BRAIN_COPY: SecondBrainCopy = {
	title: "Second Brain",
	activeBadge: "{n} active",
	newNote: "+ Note",
	searchPlaceholder: "Search the Second Brain…",
	noMatches: "No matches.",
	noActiveNotes: "No active notes yet.",
	moreHint: "+{n} more — type to search.",
	archiveTooltip: "Archive",
	deleteTooltip: "Delete",
	unarchiveTooltip: "Unarchive",
	archivedHeading: "Archive · {n}",
	restoredNotice: "Restored {name}.",
	archivedNotice: "Archived {name}.",
	deletedNotice: "Deleted {name}.",
	deleteHeading: "Delete “{name}”?",
	deleteBody: "It goes to your configured trash and is removed from any category.",
	cancel: "Cancel",
	deleteConfirm: "Delete",
	newNoteTitle: "New note",
	noteTitleLabel: "Title",
	noteTitlePlaceholder: "Note title",
	create: "Create",
	noteNeedsTitle: "A note needs a title.",
};

export class SecondBrainPanel extends BasePanel {
	id = "secondbrain";
	title = "Second Brain";
	private query = "";
	private copy: SecondBrainCopy;

	constructor(private store: LibraryStore, copy?: Partial<SecondBrainCopy>) {
		super();
		this.copy = { ...DEFAULT_SECOND_BRAIN_COPY, ...copy };
		this.title = this.copy.title;
	}

	protected renderBody(): void {
		const c = this.copy;
		const head = placard(this.el, c.title);
		const notes = this.store.listNotes();
		head.createSpan({ cls: "dash-placard-badge", text: c.activeBadge.replace("{n}", String(notes.length)) });

		const actions = this.el.createDiv({ cls: "dash-btn-row" });
		const add = actions.createEl("button", { cls: "dash-btn dash-btn-primary", text: c.newNote });
		add.addEventListener("click", () => new NewNoteModal(this.ctx.app, this.store, c, () => this.rerender()).open());

		const input = this.el.createEl("input", {
			cls: "dash-search-input",
			attr: { type: "search", placeholder: c.searchPlaceholder },
		});
		input.value = this.query;
		this.bindTextFocus(input);
		const results = this.el.createDiv({ cls: "dash-sb-results" });
		const render = () => {
			results.empty();
			const q = this.query.trim();
			const list = q ? this.fuzzy(notes, q) : notes.slice(0, 12);
			if (list.length === 0) {
				results.createDiv({ cls: "dash-muted", text: q ? c.noMatches : c.noActiveNotes });
				return;
			}
			for (const file of list) this.renderNoteRow(results, file);
			if (!q && notes.length > 12) {
				results.createDiv({ cls: "dash-muted", text: c.moreHint.replace("{n}", String(notes.length - 12)) });
			}
		};
		input.addEventListener("input", () => {
			this.query = input.value;
			render();
		});
		render();

		const archived = this.store.listArchived();
		if (archived.length > 0) {
			const arch = this.el.createEl("details", { cls: "dash-sb-archived" });
			arch.createEl("summary", { text: c.archivedHeading.replace("{n}", String(archived.length)) });
			const list = arch.createDiv();
			for (const file of archived) {
				const row = list.createDiv({ cls: "dash-sb-member" });
				const link = row.createEl("a", { cls: "dash-sb-link", text: file.basename });
				link.addEventListener("click", (e) => {
					e.preventDefault();
					void this.ctx.app.workspace.getLeaf(false).openFile(file);
				});
				this.iconBtn(row, "⤺", c.unarchiveTooltip, async () => {
					await this.store.restoreNote(file);
					new Notice(c.restoredNotice.replace("{name}", file.basename));
					this.rerender();
				});
			}
		}
	}

	private renderNoteRow(parent: HTMLElement, file: TFile): void {
		const c = this.copy;
		const row = parent.createDiv({ cls: "dash-sb-row" });
		const link = row.createEl("a", { cls: "dash-sb-link", text: file.basename });
		link.addEventListener("click", (e) => {
			e.preventDefault();
			void this.ctx.app.workspace.getLeaf(false).openFile(file);
		});
		this.iconBtn(row, "🗄", c.archiveTooltip, async () => {
			await this.store.archiveNote(file);
			new Notice(c.archivedNotice.replace("{name}", file.basename));
			this.rerender();
		});
		this.iconBtn(row, "🗑", c.deleteTooltip, () => {
			new ConfirmModal(
				this.ctx.app,
				c.deleteHeading.replace("{name}", file.basename),
				c.deleteBody,
				c.cancel,
				c.deleteConfirm,
				async () => {
					await this.store.deleteNote(file);
					new Notice(c.deletedNotice.replace("{name}", file.basename));
					this.rerender();
				}
			).open();
		});
	}

	private iconBtn(parent: HTMLElement, glyph: string, label: string, onClick: () => void): void {
		const b = parent.createEl("button", { cls: "dash-icon-btn dash-sb-icon", text: glyph, attr: { title: label, "aria-label": label } });
		b.addEventListener("click", onClick);
	}

	private fuzzy(files: TFile[], query: string): TFile[] {
		const search = prepareFuzzySearch(query);
		const scored: Array<{ file: TFile; score: number }> = [];
		for (const file of files) {
			let best = search(file.basename);
			const cache = this.ctx.app.metadataCache.getFileCache(file);
			for (const h of cache?.headings ?? []) {
				const r = search(h.heading);
				if (r && (!best || r.score > best.score)) best = r;
			}
			if (best) scored.push({ file, score: best.score });
		}
		return scored.sort((a, b) => b.score - a.score).slice(0, 20).map((s) => s.file);
	}
}

// --------------------------------------------------------------- modals

class NewNoteModal extends Modal {
	private title = "";
	constructor(app: App, private store: LibraryStore, private copy: SecondBrainCopy, private onDone: () => void) {
		super(app);
	}
	onOpen(): void {
		const c = this.copy;
		this.titleEl.setText(c.newNoteTitle);
		new Setting(this.contentEl).setName(c.noteTitleLabel).addText((t) => {
			t.setPlaceholder(c.noteTitlePlaceholder).onChange((v) => (this.title = v));
			t.inputEl.focus();
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.submit();
				}
			});
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(c.cancel).onClick(() => this.close()))
			.addButton((b) => b.setButtonText(c.create).setCta().onClick(() => void this.submit()));
	}
	private async submit(): Promise<void> {
		const title = this.title.trim();
		if (!title) {
			new Notice(this.copy.noteNeedsTitle);
			return;
		}
		const file = await this.store.createNote(title);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf(false).openFile(file);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private body: string,
		private cancelLabel: string,
		private confirmLabel: string,
		private onConfirm: () => void
	) {
		super(app);
	}
	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.createEl("p", { text: this.body });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(this.cancelLabel).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.confirmLabel)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}
