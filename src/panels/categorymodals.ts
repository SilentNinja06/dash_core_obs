import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import { LibraryStore } from "../core/library";

/**
 * Chrome copy for the note/category creation + assignment modals. A host may
 * inject its own wording; when omitted, the neutral defaults below are used, so
 * existing call sites (`new NewNoteModal(app, store, onDone)`) keep their exact
 * strings. `{note}`/`{category}` are substituted in the assigned notice.
 */
export interface CategoryModalsCopy {
	newNoteTitle: string;
	titleLabel: string;
	titlePlaceholder: string;
	categoryLabel: string;
	categoryDesc: string;
	orNewCategoryLabel: string;
	orNewCategoryDesc: string;
	newCategoryPlaceholder: string;
	noneOption: string;
	cancel: string;
	create: string;
	noteNeedsTitle: string;
	newCategoryTitle: string;
	nameLabel: string;
	namePlaceholder: string;
	categoryNeedsName: string;
	noNotesToAssign: string;
	pickNotePlaceholder: string;
	assignTitle: string;
	existingCategoryLabel: string;
	orUseCategoryDesc: string;
	assign: string;
	pickOrNameCategory: string;
	/** `Assigned {note} to {category}.` */
	assignedNotice: string;
}

export const DEFAULT_CATEGORY_MODALS_COPY: CategoryModalsCopy = {
	newNoteTitle: "New note",
	titleLabel: "Title",
	titlePlaceholder: "Note title",
	categoryLabel: "Category",
	categoryDesc: "Optional — assign on creation.",
	orNewCategoryLabel: "Or a new category",
	orNewCategoryDesc: "Creates the category and assigns this note to it.",
	newCategoryPlaceholder: "New category name",
	noneOption: "(none)",
	cancel: "Cancel",
	create: "Create",
	noteNeedsTitle: "A note needs a title.",
	newCategoryTitle: "New category",
	nameLabel: "Name",
	namePlaceholder: "Category name",
	categoryNeedsName: "A category needs a name.",
	noNotesToAssign: "No notes to assign yet.",
	pickNotePlaceholder: "Pick a note to assign…",
	assignTitle: "Assign to category",
	existingCategoryLabel: "Existing category",
	orUseCategoryDesc: "Leave blank to use the one above.",
	assign: "Assign",
	pickOrNameCategory: "Pick or name a category.",
	assignedNotice: "Assigned {note} to {category}.",
};

/** Create a note in a library and optionally assign it to a category (existing
 * from the dropdown, or a new one typed in) right from the creation modal. */
export class NewNoteModal extends Modal {
	private title = "";
	private picked = "";
	private newCategory = "";
	private copy: CategoryModalsCopy;
	constructor(app: App, private store: LibraryStore, private onDone: () => void, copy?: Partial<CategoryModalsCopy>) {
		super(app);
		this.copy = { ...DEFAULT_CATEGORY_MODALS_COPY, ...copy };
	}
	onOpen(): void {
		const c = this.copy;
		this.titleEl.setText(c.newNoteTitle);
		const cats = this.store.listCategories().map((cat) => cat.name);
		this.picked = "";

		new Setting(this.contentEl).setName(c.titleLabel).addText((t) => {
			t.setPlaceholder(c.titlePlaceholder).onChange((v) => (this.title = v));
			t.inputEl.focus();
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.submit();
				}
			});
		});

		new Setting(this.contentEl)
			.setName(c.categoryLabel)
			.setDesc(c.categoryDesc)
			.addDropdown((dd) => {
				dd.addOption("", c.noneOption);
				for (const cat of cats) dd.addOption(cat, cat);
				dd.setValue("").onChange((v) => (this.picked = v));
			});

		new Setting(this.contentEl)
			.setName(c.orNewCategoryLabel)
			.setDesc(c.orNewCategoryDesc)
			.addText((t) => t.setPlaceholder(c.newCategoryPlaceholder).onChange((v) => (this.newCategory = v)));

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
		const category = this.newCategory.trim() || this.picked.trim();
		const file = await this.store.createNote(title, category || undefined);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf(false).openFile(file);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

/** Create a new category note in a library. */
export class NewCategoryModal extends Modal {
	private name = "";
	private copy: CategoryModalsCopy;
	constructor(app: App, private store: LibraryStore, private onDone: () => void, copy?: Partial<CategoryModalsCopy>) {
		super(app);
		this.copy = { ...DEFAULT_CATEGORY_MODALS_COPY, ...copy };
	}
	onOpen(): void {
		const c = this.copy;
		this.titleEl.setText(c.newCategoryTitle);
		new Setting(this.contentEl).setName(c.nameLabel).addText((t) => {
			t.setPlaceholder(c.namePlaceholder).onChange((v) => (this.name = v));
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
		const name = this.name.trim();
		if (!name) {
			new Notice(this.copy.categoryNeedsName);
			return;
		}
		await this.store.createCategory(name);
		this.close();
		this.onDone();
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

/** Assign flow: pick a note, then pick/type a category, then assign. */
export function runAssignFlow(app: App, store: LibraryStore, onDone: () => void, copy?: Partial<CategoryModalsCopy>): void {
	const c = { ...DEFAULT_CATEGORY_MODALS_COPY, ...copy };
	const notes = store.listNotes();
	if (notes.length === 0) {
		new Notice(c.noNotesToAssign);
		return;
	}
	new NoteSuggestModal(app, notes, c.pickNotePlaceholder, (note) => {
		const cats = store.listCategories().map((cat) => cat.name);
		new CategoryPromptModal(app, cats, c, async (category) => {
			await store.assign(note, category);
			new Notice(c.assignedNotice.replace("{note}", note.basename).replace("{category}", category));
			onDone();
		}).open();
	}).open();
}

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private notes: TFile[], placeholder: string, private onChoose: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(placeholder);
	}
	getItems(): TFile[] {
		return this.notes;
	}
	getItemText(file: TFile): string {
		return file.basename;
	}
	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

/** Pick an existing category from a dropdown, or type a new one. */
class CategoryPromptModal extends Modal {
	private picked = "";
	private newName = "";
	constructor(app: App, private categories: string[], private copy: CategoryModalsCopy, private onChoose: (category: string) => void) {
		super(app);
	}
	onOpen(): void {
		const c = this.copy;
		this.titleEl.setText(c.assignTitle);
		this.picked = this.categories[0] ?? "";
		if (this.categories.length > 0) {
			new Setting(this.contentEl).setName(c.existingCategoryLabel).addDropdown((dd) => {
				for (const cat of this.categories) dd.addOption(cat, cat);
				dd.setValue(this.picked).onChange((v) => (this.picked = v));
			});
		}
		new Setting(this.contentEl)
			.setName(c.orNewCategoryLabel)
			.setDesc(c.orUseCategoryDesc)
			.addText((t) => {
				t.setPlaceholder(c.newCategoryPlaceholder).onChange((v) => (this.newName = v));
				if (this.categories.length === 0) t.inputEl.focus();
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.submit();
					}
				});
			});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(c.cancel).onClick(() => this.close()))
			.addButton((b) => b.setButtonText(c.assign).setCta().onClick(() => this.submit()));
	}
	private submit(): void {
		const category = this.newName.trim() || this.picked.trim();
		if (!category) {
			new Notice(this.copy.pickOrNameCategory);
			return;
		}
		this.close();
		this.onChoose(category);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}
