import { Notice, moment } from "obsidian";
import { BasePanel, placard } from "./types";
import { TodoInstance, describeRecurrence } from "../core/todostore";
import { allSubItemsDone, subItemDone, subItemsDoneCount } from "../core/subitems";
import { TodoEditModal, TodoModalCopy } from "./todomodal";

/**
 * Persistent to-do panel. Add / remove / edit / complete, recurring items, future
 * scheduling, per-occurrence dismiss, and roll-and-flag for slipped items.
 * Completing archives a line under the host's "completed" heading. A row can hold
 * a collapsible checklist of sub-tasks and one muted note line.
 *
 * Only the item vocabulary (what the host calls an item, and its empty-state
 * voice) is host copy (`TodoCopy`); all other chrome is neutral. The edit modal's
 * copy and the weekly-review action are injected by the host.
 */

/** Host copy for the to-do panel — just the vocabulary/voiced strings. */
export interface TodoCopy {
	/** Panel title / placard, e.g. "Directives". */
	title: string;
	/** The add button, e.g. "+ New directive". */
	addNew: string;
	/** Shown when nothing is pending, e.g. "No directives pending. …". */
	empty: string;
}

export class TodoPanel extends BasePanel {
	id = "todo";
	title: string;
	/** Which rows are expanded to show sub-tasks / note — survives re-render. */
	private expanded = new Set<string>();

	constructor(private copy: TodoCopy, private editCopy: TodoModalCopy, private openWeeklyReview: () => void) {
		super();
		this.title = copy.title;
	}

	protected renderBody(): void {
		const store = this.ctx.todos;
		const instances = store.instancesFor();
		const active = instances.filter((i) => !i.done && !i.skipped).sort(activeSort);
		const postponed = instances.filter((i) => i.skipped);
		const done = instances.filter((i) => i.done);

		const head = placard(this.el, this.copy.title);
		const overdue = active.filter((i) => i.flagged).length;
		if (overdue > 0) head.createSpan({ cls: "mrd-chip mrd-chip-warn", text: `${overdue} slipped` });
		head.createSpan({ cls: "mrd-chip", text: `${active.length} pending` });
		const reviewBtn = head.createEl("button", { cls: "mrd-btn mrd-btn-sm mrd-todo-review", text: "Weekly review" });
		reviewBtn.addEventListener("click", () => this.openWeeklyReview());

		const addBtn = this.el.createEl("button", { cls: "mrd-btn mrd-btn-primary mrd-todo-add", text: this.copy.addNew });
		addBtn.addEventListener("click", () =>
			new TodoEditModal(this.ctx.app, store, undefined, () => this.after(), this.editCopy).open()
		);

		const list = this.el.createDiv({ cls: "mrd-todo-list" });
		if (active.length === 0) {
			list.createDiv({ cls: "mrd-muted", text: this.copy.empty });
		}
		active.forEach((inst, idx) => this.renderRow(list, inst, idx, active.length));

		if (postponed.length > 0) {
			const details = this.el.createEl("details", { cls: "mrd-todo-done" });
			details.createEl("summary", { text: `Postponed · ${postponed.length}` });
			const pList = details.createDiv({ cls: "mrd-todo-list" });
			for (const inst of postponed) this.renderRow(pList, inst, -1, 0);
		}

		if (done.length > 0) {
			const details = this.el.createEl("details", { cls: "mrd-todo-done" });
			details.createEl("summary", { text: `Completed today · ${done.length}` });
			const doneList = details.createDiv({ cls: "mrd-todo-list" });
			for (const inst of done) this.renderRow(doneList, inst, -1, 0);
		}
	}

	private renderRow(parent: HTMLElement, inst: TodoInstance, idx: number, count: number): void {
		const store = this.ctx.todos;
		const item = inst.item;
		const today = moment().format("YYYY-MM-DD");
		const wrap = parent.createDiv({ cls: "mrd-todo-item" });
		const row = wrap.createDiv({ cls: "mrd-todo-row" });
		if (inst.flagged) row.addClass("is-flagged");
		if (inst.done || inst.skipped) row.addClass("is-done");

		const box = row.createEl("button", { cls: "mrd-todo-check", attr: { "aria-label": inst.done ? "Mark not done" : "Mark done" } });
		box.setText(inst.done ? "✓" : "");
		box.addEventListener("click", async () => {
			await store.toggleComplete(item.id);
			this.after();
		});

		const main = row.createDiv({ cls: "mrd-todo-main" });
		main.createDiv({ cls: "mrd-todo-text", text: item.text });
		const meta = main.createDiv({ cls: "mrd-todo-meta" });
		if (item.recurrence.type !== "none") meta.createSpan({ cls: "mrd-chip mrd-chip-cold", text: describeRecurrence(item.recurrence) });
		if (item.scheduledTime) meta.createSpan({ cls: "mrd-chip", text: item.scheduledTime });
		if (item.dueDate) {
			const overdue = !inst.done && item.dueDate < today;
			meta.createSpan({ cls: overdue ? "mrd-chip mrd-chip-warn" : "mrd-chip", text: dueLabel(item.dueDate, today) });
		}
		if (item.showOnWeekPrint) meta.createSpan({ cls: "mrd-chip mrd-chip-cold", text: "on planner" });
		if (inst.flagged) meta.createSpan({ cls: "mrd-chip mrd-chip-warn", text: inst.flagLabel });
		const subs = item.subItems ?? [];
		if (subs.length > 0) {
			const doneN = subItemsDoneCount(item, today);
			const chip = meta.createSpan({ cls: "mrd-chip mrd-chip-cold", text: `sub-tasks ${doneN}/${subs.length}` });
			if (allSubItemsDone(item, today)) chip.addClass("mrd-chip-warn");
		}

		const actions = row.createDiv({ cls: "mrd-todo-actions" });
		const hasDetail = subs.length > 0 || !!item.note;
		const isOpen = this.expanded.has(item.id);
		// The chevron always expands — collapsed rows show a caret so a fresh
		// row can still be given its first sub-task or note.
		this.iconBtn(actions, isOpen ? "▾" : "▸", hasDetail ? "Sub-tasks & note" : "Add sub-tasks or a note", false, () => {
			if (isOpen) this.expanded.delete(item.id);
			else this.expanded.add(item.id);
			this.rerender();
		});
		if (!inst.done && count > 1 && idx >= 0) {
			this.iconBtn(actions, "↑", "Move up", idx === 0, async () => {
				await this.move(idx, -1);
			});
			this.iconBtn(actions, "↓", "Move down", idx === count - 1, async () => {
				await this.move(idx, 1);
			});
		}
		this.iconBtn(actions, "✎", "Edit", false, () => {
			new TodoEditModal(this.ctx.app, store, item, () => this.after(), this.editCopy).open();
		});
		if (inst.skipped) {
			this.iconBtn(actions, "↩", "Un-postpone", false, async () => {
				await store.unskipInstance(item.id);
				this.after();
			});
		} else if (inst.recurring && !inst.done) {
			this.iconBtn(actions, "⤼", "Postpone for today", false, async () => {
				await store.skipInstance(item.id);
				new Notice("Postponed for today. It returns on the next occurrence.");
				this.after();
			});
		}
		this.iconBtn(actions, "🗑", "Delete", false, async () => {
			await store.remove(item.id);
			this.after();
		});

		if (isOpen) this.renderDetail(wrap, inst, today);
	}

	/** Expanded region: the note line (inline-editable) and the sub-task checklist. */
	private renderDetail(wrap: HTMLElement, inst: TodoInstance, today: string): void {
		const store = this.ctx.todos;
		const item = inst.item;
		const detail = wrap.createDiv({ cls: "mrd-todo-detail" });

		// --- note ---
		const noteInput = detail.createEl("input", {
			cls: "mrd-todo-note-input",
			attr: { type: "text", placeholder: "Add a note…", value: item.note ?? "" },
		});
		const saveNote = () => {
			if ((item.note ?? "") === noteInput.value.trim()) return;
			void store.setNote(item.id, noteInput.value).then(() => this.after());
		};
		noteInput.addEventListener("focus", () => (this.ctx.runtime.typingUntil = Date.now() + 2000));
		noteInput.addEventListener("input", () => (this.ctx.runtime.typingUntil = Date.now() + 2000));
		noteInput.addEventListener("blur", saveNote);
		noteInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				noteInput.blur();
			}
		});

		// --- sub-tasks ---
		const subList = detail.createDiv({ cls: "mrd-subtask-list" });
		for (const sub of item.subItems ?? []) {
			const srow = subList.createDiv({ cls: "mrd-subtask-row" });
			const done = subItemDone(item, sub.id, today);
			if (done) srow.addClass("is-done");
			const cb = srow.createEl("button", {
				cls: "mrd-subtask-check",
				attr: { "aria-label": done ? "Mark sub-task not done" : "Mark sub-task done" },
			});
			cb.setText(done ? "✓" : "");
			cb.addEventListener("click", async () => {
				await store.toggleSubItem(item.id, sub.id, today);
				this.after();
			});
			srow.createSpan({ cls: "mrd-subtask-text", text: sub.text });
			this.iconBtn(srow, "🗑", "Remove sub-task", false, async () => {
				await store.removeSubItem(item.id, sub.id);
				this.after();
			});
		}

		// --- add a sub-task ---
		const addRow = detail.createDiv({ cls: "mrd-subtask-add" });
		const addInput = addRow.createEl("input", {
			cls: "mrd-subtask-input",
			attr: { type: "text", placeholder: "Add a sub-task…" },
		});
		const addSub = () => {
			const text = addInput.value.trim();
			if (!text) return;
			void store.addSubItem(item.id, text).then(() => this.after());
		};
		addInput.addEventListener("focus", () => (this.ctx.runtime.typingUntil = Date.now() + 2000));
		addInput.addEventListener("input", () => (this.ctx.runtime.typingUntil = Date.now() + 2000));
		addInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				addSub();
			}
		});
		const addBtn = addRow.createEl("button", { cls: "mrd-btn mrd-btn-sm", text: "Add" });
		addBtn.addEventListener("click", addSub);
	}

	private iconBtn(parent: HTMLElement, glyph: string, label: string, disabled: boolean, onClick: () => void): void {
		const b = parent.createEl("button", { cls: "mrd-icon-btn mrd-todo-icon", text: glyph, attr: { "aria-label": label, title: label } });
		if (disabled) b.setAttr("disabled", "true");
		else b.addEventListener("click", onClick);
	}

	private async move(idx: number, delta: number): Promise<void> {
		const active = this.ctx.todos.instancesFor().filter((i) => !i.done).sort(activeSort);
		const ids = active.map((i) => i.item.id);
		const j = idx + delta;
		if (j < 0 || j >= ids.length) return;
		[ids[idx], ids[j]] = [ids[j], ids[idx]];
		await this.ctx.todos.reorder(ids);
		this.after();
	}

	private after(): void {
		this.ctx.requestRefresh("manual");
	}
}

function dueLabel(due: string, today: string): string {
	if (due < today) return `overdue · ${moment(due, "YYYY-MM-DD").format("MMM D")}`;
	if (due === today) return "due today";
	return `due ${moment(due, "YYYY-MM-DD").format("MMM D")}`;
}

function activeSort(a: TodoInstance, b: TodoInstance): number {
	// Flagged (slipped) first, then scheduled-time, then stored order.
	if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
	const at = a.item.scheduledTime ?? "99:99";
	const bt = b.item.scheduledTime ?? "99:99";
	if (at !== bt) return at.localeCompare(bt);
	return a.item.order - b.item.order;
}
