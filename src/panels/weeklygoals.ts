import { App, Modal, Notice, Setting, moment } from "obsidian";
import { TodoStore } from "../core/todostore";

/**
 * Weekly goals: at the start of a week the user can jot a few goals. They're
 * drawn on the printed week planner and can each be sent to the to-do list.
 * Goals are keyed by the week-start date. Persistence is injected via
 * `WeeklyGoalsStore`; the item vocabulary ("Directive" in MERIDIAN) is host copy.
 */

export function weekKeyOf(weekStart: moment.Moment): string {
	return weekStart.clone().startOf("week").format("YYYY-MM-DD");
}

export function currentWeekKey(): string {
	return weekKeyOf(moment());
}

/** "Jul 20 – Jul 26" for a week key (YYYY-MM-DD week start). */
export function weekLabel(weekKey: string): string {
	const start = moment(weekKey, "YYYY-MM-DD");
	return `${start.format("MMM D")} – ${start.clone().add(6, "days").format("MMM D")}`;
}

/** A single weekly goal. */
export interface WeeklyGoalItem {
	id: string;
	text: string;
}

/** Host persistence for weekly goals, keyed by week-start date. */
export interface WeeklyGoalsStore {
	forWeek(weekKey: string): WeeklyGoalItem[];
	add(weekKey: string, text: string): Promise<void>;
	remove(weekKey: string, id: string): Promise<void>;
}

/** Host-injected copy. `titleTemplate` uses `{week}`. */
export interface WeeklyGoalsCopy {
	titleTemplate: string;
	empty: string;
	toItem: string;
	removeGoal: string;
	addName: string;
	addPlaceholder: string;
	addButton: string;
	done: string;
	addedNotice: string;
}

export class WeeklyGoalsModal extends Modal {
	private draft = "";

	constructor(
		app: App,
		private store: WeeklyGoalsStore,
		private todos: TodoStore,
		private weekKey: string,
		private onDone: () => void,
		private copy: WeeklyGoalsCopy
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.copy.titleTemplate.replace("{week}", weekLabel(this.weekKey)));
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const goals = this.store.forWeek(this.weekKey);

		const list = contentEl.createDiv({ cls: "mrd-goals-list" });
		if (goals.length === 0) {
			list.createDiv({ cls: "mrd-muted", text: this.copy.empty });
		}
		for (const goal of goals) {
			const row = list.createDiv({ cls: "mrd-goals-row" });
			row.createSpan({ cls: "mrd-goals-text", text: goal.text });
			const actions = row.createDiv({ cls: "mrd-goals-actions" });
			const toDir = actions.createEl("button", { cls: "mrd-btn mrd-btn-sm", text: this.copy.toItem });
			toDir.addEventListener("click", () => void this.toItem(goal.text));
			const del = actions.createEl("button", {
				cls: "mrd-icon-btn",
				text: "🗑",
				attr: { "aria-label": this.copy.removeGoal, title: this.copy.removeGoal },
			});
			del.addEventListener("click", async () => {
				await this.store.remove(this.weekKey, goal.id);
				this.onDone();
				this.render();
			});
		}

		const addRow = new Setting(contentEl).setName(this.copy.addName);
		addRow.addText((t) => {
			t.setPlaceholder(this.copy.addPlaceholder).setValue(this.draft).onChange((v) => (this.draft = v));
			t.inputEl.classList.add("mrd-modal-wide");
			t.inputEl.focus();
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.add();
				}
			});
		});
		addRow.addButton((b) => b.setButtonText(this.copy.addButton).setCta().onClick(() => void this.add()));

		new Setting(contentEl).addButton((b) => b.setButtonText(this.copy.done).onClick(() => this.close()));
	}

	private async add(): Promise<void> {
		const text = this.draft.trim();
		if (!text) return;
		await this.store.add(this.weekKey, text);
		this.draft = "";
		this.onDone();
		this.render();
	}

	/** Send a goal to the to-do list as a one-time item due at week's end. */
	private async toItem(text: string): Promise<void> {
		const due = moment(this.weekKey, "YYYY-MM-DD").add(6, "days").format("YYYY-MM-DD");
		await this.todos.add({ text, dueDate: due });
		new Notice(this.copy.addedNotice);
		this.onDone();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
