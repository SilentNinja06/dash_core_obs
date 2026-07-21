import { test, is } from "./_harness";
import type { TodoItem } from "../src/core/todostore";
import { subItemDone, subItemsDoneCount, allSubItemsDone } from "../src/core/subitems";

function base(partial: Partial<TodoItem>): TodoItem {
	return {
		id: "p",
		text: "parent",
		recurrence: { type: "none" },
		createdAt: 0,
		order: 0,
		...partial,
	};
}

test("subItemDone: non-recurring uses the flat done flag", () => {
	const item = base({
		subItems: [
			{ id: "a", text: "a", done: true },
			{ id: "b", text: "b", done: false },
		],
	});
	is(subItemDone(item, "a", "2026-07-19"), true);
	is(subItemDone(item, "b", "2026-07-19"), false);
	// Date is irrelevant for non-recurring parents.
	is(subItemDone(item, "a", "2020-01-01"), true);
});

test("subItemDone: recurring resolves per-occurrence, ignoring the flat flag", () => {
	const item = base({
		recurrence: { type: "daily" },
		// Flat done must NOT leak across occurrences.
		subItems: [
			{ id: "a", text: "a", done: true },
			{ id: "b", text: "b", done: true },
		],
		subCompletions: { "2026-07-20": ["a"] },
	});
	// Monday-checked doesn't show checked on another day.
	is(subItemDone(item, "a", "2026-07-20"), true);
	is(subItemDone(item, "b", "2026-07-20"), false);
	is(subItemDone(item, "a", "2026-07-21"), false);
	is(subItemDone(item, "a", "2026-07-19"), false);
});

test("subItemsDoneCount + allSubItemsDone honour per-occurrence state", () => {
	const item = base({
		recurrence: { type: "weekly", days: [1] },
		subItems: [
			{ id: "a", text: "a", done: false },
			{ id: "b", text: "b", done: false },
		],
		subCompletions: { "2026-07-20": ["a", "b"], "2026-07-27": ["a"] },
	});
	is(subItemsDoneCount(item, "2026-07-20"), 2);
	is(allSubItemsDone(item, "2026-07-20"), true);
	is(subItemsDoneCount(item, "2026-07-27"), 1);
	is(allSubItemsDone(item, "2026-07-27"), false);
	is(allSubItemsDone(item, "2026-07-13"), false);
});

test("allSubItemsDone is false when there are no sub-items", () => {
	is(allSubItemsDone(base({}), "2026-07-19"), false);
});
