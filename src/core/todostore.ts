import { App, moment } from "obsidian";
import { appendDailyLogLine } from "./dailynote";

/**
 * Persistent to-do + recurrence engine (§7.4). The store is authoritative;
 * nothing resets overnight. Completing an item appends a `- HH:MM <text>` line
 * under `# Completed tasks` in today's note as a one-way archive — the note is
 * never re-read as state.
 *
 * Overdue policy:
 *  - Non-recurring scheduled items past their date roll to today and carry a
 *    "carried over" flag (roll-and-flag, once — not an accumulating pile).
 *  - Recurring items show only on their occurrence dates; if the *previous*
 *    occurrence was neither completed nor dismissed, today's instance carries a
 *    "missed last time" flag. Daily recurrences therefore show today flagged
 *    "missed yesterday".
 *  - A single occurrence can be dismissed/skipped: it leaves the list for that
 *    day, does not flag the next occurrence as missed, and does not remove any
 *    future recurrence.
 */

export type RecurrenceType = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "everyNDays";

export interface Recurrence {
	type: RecurrenceType;
	/** weekly: 0=Sun … 6=Sat */
	days?: number[];
	/** monthly: day of month 1–31 */
	date?: number;
	/** everyNDays: interval */
	n?: number;
}

/** A single sub-task under a directive (§1.2). For non-recurring parents `done`
 * is the flat, global state; for recurring parents per-occurrence state lives in
 * `TodoItem.subCompletions` and `done` is ignored — resolve via `subItemDone`. */
export interface SubItem {
	id: string;
	text: string;
	done: boolean;
}

export interface TodoItem {
	id: string;
	text: string;
	recurrence: Recurrence;
	createdAt: number;
	order: number;
	/** Hidden until this date (YYYY-MM-DD). For recurring items this is also the
	 * earliest eligible occurrence. Empty = active immediately / always. */
	scheduledDate?: string;
	/** Optional time-of-day the item appears on its date (HH:mm). */
	scheduledTime?: string;
	/** Optional soft deadline (YYYY-MM-DD). Shown as a chip; past-due, undone
	 * items read "overdue". Independent of `scheduledDate` (the appear-on date). */
	dueDate?: string;
	/** Whether this directive is drawn on the printed week-at-a-glance planner on
	 * its occurrence / scheduled / due days. Opt-in (default off). */
	showOnWeekPrint?: boolean;
	// --- non-recurring completion ---
	completed?: boolean;
	completedDate?: string;
	// --- recurring per-date state ---
	completions?: string[];
	skips?: string[];
	// --- sub-items + note (§1.2) ---
	/** Optional single muted note line under the directive text. */
	note?: string;
	/** Collapsible checklist of sub-tasks. */
	subItems?: SubItem[];
	/** Per-occurrence sub-item completion for recurring parents, keyed by date —
	 * mirrors how `completions`/`skips` key by date so Monday's checked sub-items
	 * don't show checked again next Monday. Non-recurring items use `SubItem.done`. */
	subCompletions?: Record<string /*YYYY-MM-DD*/, string[] /*subItem ids done that day*/>;
}

export interface TodoInstance {
	item: TodoItem;
	/** True when this instance carries a slip flag (carried over / missed last time). */
	flagged: boolean;
	flagLabel: string;
	/** True when done for the reference day (non-recurring completed, or today in completions). */
	done: boolean;
	/** True when this recurring occurrence was postponed (skipped) for the day. */
	skipped: boolean;
	recurring: boolean;
}

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
	none: "One-time",
	daily: "Daily",
	weekdays: "Weekdays",
	weekly: "Weekly",
	monthly: "Monthly",
	everyNDays: "Every N days",
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeRecurrence(r: Recurrence): string {
	switch (r.type) {
		case "none":
			return "One-time";
		case "daily":
			return "Every day";
		case "weekdays":
			return "Weekdays";
		case "weekly": {
			const days = (r.days ?? []).slice().sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]);
			return days.length ? `Weekly · ${days.join(", ")}` : "Weekly";
		}
		case "monthly":
			return `Monthly · day ${r.date ?? 1}`;
		case "everyNDays":
			return `Every ${r.n ?? 2} days`;
	}
}

// ------------------------------------------------------------- date helpers

function todayStr(): string {
	return moment().format("YYYY-MM-DD");
}

function nowTime(): string {
	return moment().format("HH:mm");
}

function weekday(date: string): number {
	return moment(date, "YYYY-MM-DD").day();
}

function dayOfMonth(date: string): number {
	return moment(date, "YYYY-MM-DD").date();
}

function lastDayOfMonth(date: string): number {
	return moment(date, "YYYY-MM-DD").daysInMonth();
}

function daysBetween(a: string, b: string): number {
	return moment(b, "YYYY-MM-DD").diff(moment(a, "YYYY-MM-DD"), "days");
}

// ---------------------------------------------------------------- the store

export class TodoStore {
	constructor(
		private app: App,
		private getItems: () => TodoItem[],
		private setItems: (items: TodoItem[]) => void,
		private save: () => Promise<void>,
		private getLogTarget: () => { marker: string; heading: string }
	) {}

	all(): TodoItem[] {
		return this.getItems().slice().sort((a, b) => a.order - b.order);
	}

	private anchorDate(item: TodoItem): string {
		return item.scheduledDate || moment(item.createdAt).format("YYYY-MM-DD");
	}

	/** Whether `date` is an occurrence for this item's recurrence. */
	isOccurrence(item: TodoItem, date: string): boolean {
		const start = item.scheduledDate;
		if (start && date < start) return false;
		const r = item.recurrence;
		switch (r.type) {
			case "none":
				// A one-time item "occurs" on/after its scheduled date (it rolls).
				return start ? date >= start : true;
			case "daily":
				return true;
			case "weekdays": {
				const d = weekday(date);
				return d >= 1 && d <= 5;
			}
			case "weekly":
				return (r.days ?? []).includes(weekday(date));
			case "monthly": {
				const target = r.date ?? 1;
				const dom = dayOfMonth(date);
				if (dom === target) return true;
				// Clamp: on months without the target day, fire on the last day.
				return target > lastDayOfMonth(date) && dom === lastDayOfMonth(date);
			}
			case "everyNDays": {
				const n = Math.max(1, r.n ?? 2);
				return daysBetween(this.anchorDate(item), date) % n === 0;
			}
		}
	}

	/** Latest occurrence strictly before `date`, or null. Bounded scan. */
	private previousOccurrence(item: TodoItem, date: string): string | null {
		for (let i = 1; i <= 366; i++) {
			const d = moment(date, "YYYY-MM-DD").subtract(i, "days").format("YYYY-MM-DD");
			if (item.scheduledDate && d < item.scheduledDate) return null;
			if (this.isOccurrence(item, d)) return d;
		}
		return null;
	}

	private isRecurring(item: TodoItem): boolean {
		return item.recurrence.type !== "none";
	}

	private isHiddenByTime(item: TodoItem, date: string): boolean {
		// Future-scheduled items are hidden until their date, and until their
		// time-of-day on that date.
		if (item.scheduledDate && date < item.scheduledDate) return true;
		if (item.scheduledDate === date && item.scheduledTime) {
			return nowTime() < item.scheduledTime;
		}
		return false;
	}

	/** Instances to render for `date` (default today): eligible, not future-hidden. */
	instancesFor(date = todayStr()): TodoInstance[] {
		const out: TodoInstance[] = [];
		for (const item of this.all()) {
			if (this.isHiddenByTime(item, date)) continue;

			if (this.isRecurring(item)) {
				if (!this.isOccurrence(item, date)) continue;
				const done = (item.completions ?? []).includes(date);
				const skipped = !done && (item.skips ?? []).includes(date);
				const prev = this.previousOccurrence(item, date);
				const missed =
					!done &&
					!skipped &&
					!!prev &&
					!(item.completions ?? []).includes(prev) &&
					!(item.skips ?? []).includes(prev);
				out.push({
					item,
					recurring: true,
					done,
					skipped,
					flagged: missed,
					flagLabel: missed ? missedLabel(prev, date) : "",
				});
			} else {
				// one-time
				if (item.completed) {
					if (item.completedDate === date) {
						out.push({ item, recurring: false, done: true, skipped: false, flagged: false, flagLabel: "" });
					}
					continue;
				}
				const carried = !!item.scheduledDate && item.scheduledDate < date;
				out.push({
					item,
					recurring: false,
					done: false,
					skipped: false,
					flagged: carried,
					flagLabel: carried ? "carried over" : "",
				});
			}
		}
		return out;
	}

	/** Directives to draw on the printed week planner for `date`: opt-in items
	 * that occur on that date (recurring), or whose scheduled/due date is that day
	 * (one-time). Ignores time-of-day hiding and completion — the planner is a
	 * blank-space paper artifact, not the live list. */
	itemsForWeekPrint(date: string): TodoItem[] {
		const out: TodoItem[] = [];
		for (const item of this.all()) {
			if (!item.showOnWeekPrint) continue;
			if (this.isRecurring(item)) {
				if (this.isOccurrence(item, date)) out.push(item);
			} else if (item.scheduledDate === date || item.dueDate === date) {
				out.push(item);
			}
		}
		return out;
	}

	/** Count of slipped items for overdue-based weighting. */
	overdueCount(date = todayStr()): number {
		return this.instancesFor(date).filter((i) => i.flagged && !i.done).length;
	}

	/** Count of pending (undone, un-postponed, eligible) items today. */
	pendingCount(date = todayStr()): number {
		return this.instancesFor(date).filter((i) => !i.done && !i.skipped).length;
	}

	/** The top pending instance for `date` in the same order the panel shows —
	 * flagged (slipped) first, then by scheduled time, then stored order. Used by
	 * the `complete-next-directive` command (§1.1). */
	firstPending(date = todayStr()): TodoInstance | null {
		const active = this.instancesFor(date).filter((i) => !i.done && !i.skipped);
		active.sort((a, b) => {
			if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
			const at = a.item.scheduledTime ?? "99:99";
			const bt = b.item.scheduledTime ?? "99:99";
			if (at !== bt) return at.localeCompare(bt);
			return a.item.order - b.item.order;
		});
		return active[0] ?? null;
	}

	// ----------------------------------------------------------- mutations

	async add(partial: Partial<TodoItem> & { text: string }): Promise<void> {
		const items = this.getItems();
		const maxOrder = items.reduce((m, i) => Math.max(m, i.order), 0);
		const item: TodoItem = {
			id: cryptoId(),
			text: partial.text.trim(),
			recurrence: partial.recurrence ?? { type: "none" },
			createdAt: Date.now(),
			order: maxOrder + 1,
			scheduledDate: partial.scheduledDate,
			scheduledTime: partial.scheduledTime,
			dueDate: partial.dueDate,
			showOnWeekPrint: partial.showOnWeekPrint,
			completions: [],
			skips: [],
		};
		items.push(item);
		this.setItems(items);
		await this.save();
	}

	async update(id: string, patch: Partial<TodoItem>): Promise<void> {
		const items = this.getItems();
		const item = items.find((i) => i.id === id);
		if (!item) return;
		Object.assign(item, patch);
		this.setItems(items);
		await this.save();
	}

	/** First-class removal (§7.4) — deletes the item and all its recurrence. */
	async remove(id: string): Promise<void> {
		this.setItems(this.getItems().filter((i) => i.id !== id));
		await this.save();
	}

	// ------------------------------------------------- sub-items + note (§1.2)

	/** Add a sub-task to a directive. */
	async addSubItem(parentId: string, text: string): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed) return;
		const items = this.getItems();
		const item = items.find((i) => i.id === parentId);
		if (!item) return;
		(item.subItems ?? (item.subItems = [])).push({ id: cryptoId(), text: trimmed, done: false });
		this.setItems(items);
		await this.save();
	}

	/** Remove a sub-task, and forget its per-occurrence completion state. */
	async removeSubItem(parentId: string, subId: string): Promise<void> {
		const items = this.getItems();
		const item = items.find((i) => i.id === parentId);
		if (!item) return;
		item.subItems = (item.subItems ?? []).filter((s) => s.id !== subId);
		if (item.subCompletions) {
			for (const date of Object.keys(item.subCompletions)) {
				item.subCompletions[date] = item.subCompletions[date].filter((id) => id !== subId);
				if (item.subCompletions[date].length === 0) delete item.subCompletions[date];
			}
		}
		this.setItems(items);
		await this.save();
	}

	/** Toggle a sub-task's done state for `date`. Recurring parents key the state
	 * by date; non-recurring parents use the flat `SubItem.done`. */
	async toggleSubItem(parentId: string, subId: string, date = todayStr()): Promise<void> {
		const items = this.getItems();
		const item = items.find((i) => i.id === parentId);
		if (!item) return;
		const sub = (item.subItems ?? []).find((s) => s.id === subId);
		if (!sub) return;
		if (this.isRecurring(item)) {
			const map = item.subCompletions ?? (item.subCompletions = {});
			const set = new Set(map[date] ?? []);
			if (set.has(subId)) set.delete(subId);
			else set.add(subId);
			if (set.size === 0) delete map[date];
			else map[date] = [...set];
		} else {
			sub.done = !sub.done;
		}
		this.setItems(items);
		await this.save();
	}

	/** Set (or clear) the directive's single note line. */
	async setNote(id: string, text: string): Promise<void> {
		const items = this.getItems();
		const item = items.find((i) => i.id === id);
		if (!item) return;
		const trimmed = text.trim();
		item.note = trimmed || undefined;
		this.setItems(items);
		await this.save();
	}

	async reorder(orderedIds: string[]): Promise<void> {
		const items = this.getItems();
		orderedIds.forEach((id, idx) => {
			const item = items.find((i) => i.id === id);
			if (item) item.order = idx;
		});
		this.setItems(items);
		await this.save();
	}

	/** Toggle completion for `date` (default today). Appends the archive line on
	 * the transition into completed; un-completing does not touch the note. */
	async toggleComplete(id: string, date = todayStr()): Promise<void> {
		const items = this.getItems();
		const item = items.find((i) => i.id === id);
		if (!item) return;
		let didComplete = false;
		if (this.isRecurring(item)) {
			const set = new Set(item.completions ?? []);
			if (set.has(date)) {
				set.delete(date);
			} else {
				set.add(date);
				(item.skips ?? (item.skips = [])); // ensure array
				item.skips = (item.skips ?? []).filter((d) => d !== date);
				didComplete = true;
			}
			item.completions = [...set];
		} else {
			if (item.completed && item.completedDate === date) {
				item.completed = false;
				item.completedDate = undefined;
			} else {
				item.completed = true;
				item.completedDate = date;
				didComplete = true;
			}
		}
		this.setItems(items);
		await this.save();
		if (didComplete && date === todayStr()) await this.archiveCompletion(item);
	}

	/** Dismiss/skip a single occurrence (recurring): leaves today's list, keeps
	 * future recurrence, and does not flag the next occurrence as missed. */
	async skipInstance(id: string, date = todayStr()): Promise<void> {
		const items = this.getItems();
		const item = items.find((i) => i.id === id);
		if (!item) return;
		if (this.isRecurring(item)) {
			const set = new Set(item.skips ?? []);
			set.add(date);
			item.skips = [...set];
			// A skipped occurrence is not also completed.
			item.completions = (item.completions ?? []).filter((d) => d !== date);
		} else {
			// One-time: dismissing an instance is dismissing the item.
			item.completed = true;
			item.completedDate = date;
		}
		this.setItems(items);
		await this.save();
	}

	/** Un-postpone a skipped occurrence — bring it back to the active list. */
	async unskipInstance(id: string, date = todayStr()): Promise<void> {
		const items = this.getItems();
		const item = items.find((i) => i.id === id);
		if (!item) return;
		if (this.isRecurring(item)) {
			item.skips = (item.skips ?? []).filter((d) => d !== date);
		} else if (item.completedDate === date) {
			// One-time skip was a completion; undo it.
			item.completed = false;
			item.completedDate = undefined;
		}
		this.setItems(items);
		await this.save();
	}

	private async archiveCompletion(item: TodoItem): Promise<void> {
		const { marker, heading } = this.getLogTarget();
		const time = nowTime();
		try {
			await appendDailyLogLine(this.app, `- ${time} ${item.text}`, { marker, heading, time });
		} catch (e) {
			// The archive is a convenience; never let it block completion state.
			console.error("dash-core: could not archive completed task", e);
		}
	}
}

function missedLabel(prev: string | null, date: string): string {
	if (!prev) return "missed";
	const diff = daysBetween(prev, date);
	if (diff === 1) return "missed yesterday";
	return `missed ${moment(prev, "YYYY-MM-DD").format("MMM D")}`;
}

/** A collision-resistant id for directives and sub-items. Uses
 * `crypto.randomUUID` where available (Obsidian's Electron/mobile webviews),
 * with a timestamp-based fallback. Exported so hosts that seed their own
 * starter directives can mint ids the same way. */
export function cryptoId(): string {
	const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
	if (c?.randomUUID) return c.randomUUID();
	return "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
