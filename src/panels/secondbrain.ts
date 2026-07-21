import { App, Modal, Notice, Setting, TFile, prepareFuzzySearch } from "obsidian";
import { BasePanel, placard } from "./types";
import { LibraryStore } from "../core/library";

/**
 * Second Brain panel — an ongoing-project note library. Search it, add notes, and
 * delete / archive / unarchive them. The library store is injected by the host;
 * strings are neutral note-library chrome.
 */
export class SecondBrainPanel extends BasePanel {
	id = "secondbrain";
	title = "Second Brain";
	private query = "";

	constructor(private store: LibraryStore) {
		super();
	}

	protected renderBody(): void {
		const head = placard(this.el, "Second Brain");
		const notes = this.store.listNotes();
		head.createSpan({ cls: "mrd-placard-badge", text: `${notes.length} active` });

		const actions = this.el.createDiv({ cls: "mrd-btn-row" });
		const add = actions.createEl("button", { cls: "mrd-btn mrd-btn-primary", text: "+ Note" });
		add.addEventListener("click", () => new NewNoteModal(this.ctx.app, this.store, () => this.rerender()).open());

		const input = this.el.createEl("input", {
			cls: "mrd-search-input",
			attr: { type: "search", placeholder: "Search the Second Brain…" },
		});
		input.value = this.query;
		const results = this.el.createDiv({ cls: "mrd-sb-results" });
		const render = () => {
			results.empty();
			const q = this.query.trim();
			const list = q ? this.fuzzy(notes, q) : notes.slice(0, 12);
			if (list.length === 0) {
				results.createDiv({ cls: "mrd-muted", text: q ? "No matches." : "No active notes yet." });
				return;
			}
			for (const file of list) this.renderNoteRow(results, file);
			if (!q && notes.length > 12) {
				results.createDiv({ cls: "mrd-muted", text: `+${notes.length - 12} more — type to search.` });
			}
		};
		input.addEventListener("input", () => {
			this.query = input.value;
			render();
		});
		render();

		const archived = this.store.listArchived();
		if (archived.length > 0) {
			const arch = this.el.createEl("details", { cls: "mrd-sb-archived" });
			arch.createEl("summary", { text: `Archive · ${archived.length}` });
			const list = arch.createDiv();
			for (const file of archived) {
				const row = list.createDiv({ cls: "mrd-sb-member" });
				const link = row.createEl("a", { cls: "mrd-sb-link", text: file.basename });
				link.addEventListener("click", (e) => {
					e.preventDefault();
					void this.ctx.app.workspace.getLeaf(false).openFile(file);
				});
				this.iconBtn(row, "⤺", "Unarchive", async () => {
					await this.store.restoreNote(file);
					new Notice(`Restored ${file.basename}.`);
					this.rerender();
				});
			}
		}
	}

	private renderNoteRow(parent: HTMLElement, file: TFile): void {
		const row = parent.createDiv({ cls: "mrd-sb-row" });
		const link = row.createEl("a", { cls: "mrd-sb-link", text: file.basename });
		link.addEventListener("click", (e) => {
			e.preventDefault();
			void this.ctx.app.workspace.getLeaf(false).openFile(file);
		});
		this.iconBtn(row, "🗄", "Archive", async () => {
			await this.store.archiveNote(file);
			new Notice(`Archived ${file.basename}.`);
			this.rerender();
		});
		this.iconBtn(row, "🗑", "Delete", () => {
			new ConfirmModal(this.ctx.app, `Delete “${file.basename}”?`, "It goes to your configured trash and is removed from any category.", async () => {
				await this.store.deleteNote(file);
				new Notice(`Deleted ${file.basename}.`);
				this.rerender();
			}).open();
		});
	}

	private iconBtn(parent: HTMLElement, glyph: string, label: string, onClick: () => void): void {
		const b = parent.createEl("button", { cls: "mrd-icon-btn mrd-sb-icon", text: glyph, attr: { title: label, "aria-label": label } });
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
	constructor(app: App, private store: LibraryStore, private onDone: () => void) {
		super(app);
	}
	onOpen(): void {
		this.titleEl.setText("New note");
		new Setting(this.contentEl).setName("Title").addText((t) => {
			t.setPlaceholder("Note title").onChange((v) => (this.title = v));
			t.inputEl.focus();
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.submit();
				}
			});
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Create").setCta().onClick(() => void this.submit()));
	}
	private async submit(): Promise<void> {
		const title = this.title.trim();
		if (!title) {
			new Notice("A note needs a title.");
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
	constructor(app: App, private heading: string, private body: string, private onConfirm: () => void) {
		super(app);
	}
	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.createEl("p", { text: this.body });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Delete")
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
