import { App, Modal, Notice, Setting, moment } from "obsidian";
import { Recurrence, RecurrenceType, TodoItem, TodoStore } from "../core/todostore";

/**
 * The add/edit modal for a directive/task item. Extracted from the panel so a
 * command palette / URI handler can open the exact same modal without a
 * dashboard leaf mounted. Sub-items and the note line are edited inline on the
 * row itself; this modal owns text, recurrence, and scheduling.
 *
 * The host supplies the few user-facing strings that carry its vocabulary (what
 * it calls an item — "directive", "task", …) via `TodoModalCopy`; everything
 * else here is neutral generic form chrome.
 */

/** Host-injected copy for the item vocabulary. Core holds no voice. */
export interface TodoModalCopy {
	/** Title when editing an existing item, e.g. "Edit directive". */
	editTitle: string;
	/** Title when creating, e.g. "New directive". */
	newTitle: string;
	/** The text field's label, e.g. "Directive". */
	itemLabel: string;
	/** Description under the week-planner toggle, naming the item, e.g.
	 * "Draw this directive on the week-at-a-glance print …". */
	weekPrintDesc: string;
	/** Notice shown when the text field is empty, e.g. "A directive needs text.". */
	needsText: string;
}

const WEEKDAYS: Array<{ v: number; label: string }> = [
	{ v: 1, label: "Mon" },
	{ v: 2, label: "Tue" },
	{ v: 3, label: "Wed" },
	{ v: 4, label: "Thu" },
	{ v: 5, label: "Fri" },
	{ v: 6, label: "Sat" },
	{ v: 0, label: "Sun" },
];

export class TodoEditModal extends Modal {
	private text: string;
	private recType: RecurrenceType;
	private weeklyDays: Set<number>;
	private monthlyDate: number;
	private everyN: number;
	private scheduledDate: string;
	private scheduledTime: string;
	private dueDate: string;
	private showOnWeekPrint: boolean;

	constructor(
		app: App,
		private store: TodoStore,
		private existing: TodoItem | undefined,
		private onDone: () => void,
		private copy: TodoModalCopy,
		private defaults?: Partial<TodoItem>
	) {
		super(app);
		const e = existing;
		this.text = e?.text ?? defaults?.text ?? "";
		this.recType = e?.recurrence.type ?? "none";
		this.weeklyDays = new Set(e?.recurrence.days ?? [moment().day()]);
		this.monthlyDate = e?.recurrence.date ?? moment().date();
		this.everyN = e?.recurrence.n ?? 2;
		this.scheduledDate = e?.scheduledDate ?? "";
		this.scheduledTime = e?.scheduledTime ?? "";
		this.dueDate = e?.dueDate ?? defaults?.dueDate ?? "";
		this.showOnWeekPrint = e?.showOnWeekPrint ?? defaults?.showOnWeekPrint ?? false;
	}

	onOpen(): void {
		this.titleEl.setText(this.existing ? this.copy.editTitle : this.copy.newTitle);
		const { contentEl } = this;

		new Setting(contentEl).setName(this.copy.itemLabel).addText((t) => {
			t.setPlaceholder("What needs doing").setValue(this.text).onChange((v) => (this.text = v));
			t.inputEl.classList.add("mrd-modal-wide");
			t.inputEl.focus();
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.submit();
				}
			});
		});

		const dynamic = contentEl.createDiv();
		new Setting(contentEl)
			.setName("Repeat")
			.addDropdown((dd) => {
				dd.addOptions({
					none: "One-time",
					daily: "Daily",
					weekdays: "Weekdays (Mon–Fri)",
					weekly: "Weekly",
					monthly: "Monthly",
					everyNDays: "Every N days",
				});
				dd.setValue(this.recType).onChange((v) => {
					this.recType = v as RecurrenceType;
					this.renderDynamic(dynamic);
				});
			});
		contentEl.appendChild(dynamic);
		this.renderDynamic(dynamic);

		new Setting(contentEl)
			.setName("Appear on")
			.setDesc("Optional. Hidden until this date (and time). For repeats, the start date.")
			.addText((t) => {
				t.inputEl.type = "date";
				t.setValue(this.scheduledDate).onChange((v) => (this.scheduledDate = v));
			})
			.addText((t) => {
				t.inputEl.type = "time";
				t.setValue(this.scheduledTime).onChange((v) => (this.scheduledTime = v));
			});

		new Setting(contentEl)
			.setName("Due")
			.setDesc("Optional soft deadline. Shown as a chip; past-due reads “overdue”.")
			.addText((t) => {
				t.inputEl.type = "date";
				t.setValue(this.dueDate).onChange((v) => (this.dueDate = v));
			});

		new Setting(contentEl)
			.setName("Show on printed week planner")
			.setDesc(this.copy.weekPrintDesc)
			.addToggle((t) => t.setValue(this.showOnWeekPrint).onChange((v) => (this.showOnWeekPrint = v)));

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText(this.existing ? "Save" : "Add").setCta().onClick(() => this.submit()));
	}

	private renderDynamic(host: HTMLElement): void {
		host.empty();
		if (this.recType === "weekly") {
			const s = new Setting(host).setName("On days");
			for (const d of WEEKDAYS) {
				const btn = s.controlEl.createEl("button", { cls: "mrd-day-toggle", text: d.label });
				if (this.weeklyDays.has(d.v)) btn.addClass("is-on");
				btn.addEventListener("click", () => {
					if (this.weeklyDays.has(d.v)) this.weeklyDays.delete(d.v);
					else this.weeklyDays.add(d.v);
					btn.toggleClass("is-on", this.weeklyDays.has(d.v));
				});
			}
		} else if (this.recType === "monthly") {
			new Setting(host).setName("Day of month").addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1";
				t.inputEl.max = "31";
				t.setValue(String(this.monthlyDate)).onChange((v) => (this.monthlyDate = clamp(Number(v), 1, 31)));
			});
		} else if (this.recType === "everyNDays") {
			new Setting(host).setName("Every").setDesc("days").addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1";
				t.setValue(String(this.everyN)).onChange((v) => (this.everyN = Math.max(1, Number(v) || 1)));
			});
		}
	}

	private buildRecurrence(): Recurrence {
		switch (this.recType) {
			case "weekly":
				return { type: "weekly", days: [...this.weeklyDays].sort((a, b) => a - b) };
			case "monthly":
				return { type: "monthly", date: this.monthlyDate };
			case "everyNDays":
				return { type: "everyNDays", n: this.everyN };
			default:
				return { type: this.recType };
		}
	}

	private async submit(): Promise<void> {
		const text = this.text.trim();
		if (!text) {
			new Notice(this.copy.needsText);
			return;
		}
		const patch = {
			text,
			recurrence: this.buildRecurrence(),
			scheduledDate: this.scheduledDate || undefined,
			scheduledTime: this.scheduledTime || undefined,
			dueDate: this.dueDate || undefined,
			showOnWeekPrint: this.showOnWeekPrint,
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

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}
