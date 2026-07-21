import { App, Modal, Notice, Setting, moment } from "obsidian";
import { LocalEvent } from "../core/localevents";

/**
 * Add / edit / delete a local event. Local events are dashboard-only — never
 * written to the daily note or any ICS. All-day when no start time. The item
 * vocabulary ("event") is generic, so all strings stay in core; persistence is
 * injected via `LocalEventsStore` (the host owns where events live).
 */

/** The CRUD the modal needs; a host implements it over its own event store. */
export interface LocalEventsStore {
	add(patch: Omit<LocalEvent, "id">): Promise<void>;
	update(id: string, patch: Omit<LocalEvent, "id">): Promise<void>;
	remove(id: string): Promise<void>;
}

export class LocalEventModal extends Modal {
	private summary: string;
	private date: string;
	private start: string;
	private end: string;

	constructor(
		app: App,
		private store: LocalEventsStore,
		private existing: LocalEvent | undefined,
		private onDone: () => void
	) {
		super(app);
		const e = existing;
		this.summary = e?.summary ?? "";
		this.date = e?.date ?? moment().format("YYYY-MM-DD");
		this.start = e?.start ?? "";
		this.end = e?.end ?? "";
	}

	onOpen(): void {
		this.titleEl.setText(this.existing ? "Edit event" : "New event");
		const { contentEl } = this;

		new Setting(contentEl).setName("Event").addText((t) => {
			t.setPlaceholder("What's on").setValue(this.summary).onChange((v) => (this.summary = v));
			t.inputEl.classList.add("dash-modal-wide");
			t.inputEl.focus();
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.submit();
				}
			});
		});

		new Setting(contentEl).setName("Date").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(this.date).onChange((v) => (this.date = v));
		});

		new Setting(contentEl)
			.setName("Time")
			.setDesc("Optional. Leave the start empty for an all-day event.")
			.addText((t) => {
				t.inputEl.type = "time";
				t.setValue(this.start).onChange((v) => (this.start = v));
			})
			.addText((t) => {
				t.inputEl.type = "time";
				t.setValue(this.end).onChange((v) => (this.end = v));
			});

		const buttons = new Setting(contentEl);
		if (this.existing) {
			buttons.addButton((b) =>
				b
					.setButtonText("Delete")
					.setWarning()
					.onClick(async () => {
						await this.store.remove(this.existing!.id);
						this.close();
						this.onDone();
					})
			);
		}
		buttons.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		buttons.addButton((b) => b.setButtonText(this.existing ? "Save" : "Add").setCta().onClick(() => void this.submit()));
	}

	private async submit(): Promise<void> {
		const summary = this.summary.trim();
		if (!summary) {
			new Notice("An event needs a description.");
			return;
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date)) {
			new Notice("An event needs a valid date.");
			return;
		}
		const patch = {
			summary,
			date: this.date,
			start: this.start || undefined,
			end: this.start && this.end ? this.end : undefined,
		};
		if (this.existing) await this.store.update(this.existing.id, patch);
		else await this.store.add(patch);
		this.close();
		this.onDone();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
