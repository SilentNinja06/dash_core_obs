import type { TodoItem } from "./todostore";

/**
 * Sub-item resolution (§1.2). Kept as pure functions (no Obsidian, no clock) so
 * the per-occurrence logic can be unit-tested and so panels never have to branch
 * on whether the parent recurs.
 *
 * A recurring parent stores sub-item completion per date in `subCompletions`
 * (mirroring `completions`/`skips`); a non-recurring parent uses the flat
 * `SubItem.done` field.
 */

export function isRecurringItem(item: TodoItem): boolean {
	return item.recurrence.type !== "none";
}

/** Whether sub-item `subId` of `item` is done for `date`. */
export function subItemDone(item: TodoItem, subId: string, date: string): boolean {
	if (isRecurringItem(item)) {
		return (item.subCompletions?.[date] ?? []).includes(subId);
	}
	return !!item.subItems?.find((s) => s.id === subId)?.done;
}

/** Count of sub-items done for `date`, resolving per-occurrence for recurring parents. */
export function subItemsDoneCount(item: TodoItem, date: string): number {
	const subs = item.subItems ?? [];
	return subs.filter((s) => subItemDone(item, s.id, date)).length;
}

/** True when the item has sub-items and every one of them is done for `date`. */
export function allSubItemsDone(item: TodoItem, date: string): boolean {
	const subs = item.subItems ?? [];
	return subs.length > 0 && subs.every((s) => subItemDone(item, s.id, date));
}
