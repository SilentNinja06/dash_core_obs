import { test, eq, ok } from "./_harness";
import type { TodoItem } from "../src/core/todostore";
import { buildMarkdown, parseTodos } from "../src/core/directivesserde";

test("directives round-trip preserves sub-items, per-occurrence sub-completions, and note", () => {
	const items: TodoItem[] = [
		{
			id: "t1",
			text: "Weekly review",
			recurrence: { type: "weekly", days: [1] },
			createdAt: 1700000000000,
			order: 0,
			scheduledTime: "09:00",
			dueDate: "2026-07-24",
			showOnWeekPrint: true,
			completions: ["2026-07-20"],
			skips: [],
			note: "Bring the printed planner.",
			subItems: [
				{ id: "s1", text: "Tidy inbox", done: false },
				{ id: "s2", text: "Plan the week", done: false },
			],
			subCompletions: { "2026-07-20": ["s1"] },
		},
	];
	const restored = parseTodos(buildMarkdown(items));
	eq(restored, items);
});

test("parseTodos tolerates a legacy pre-1.7 item with no new fields", () => {
	const legacy = `%% header %%\n\n\`\`\`json\n${JSON.stringify({
		version: 1,
		todos: [{ id: "a", text: "old", recurrence: { type: "none" }, createdAt: 1, order: 0 }],
	})}\n\`\`\`\n`;
	const items = parseTodos(legacy);
	eq(items.length, 1);
	eq(items[0].subItems, undefined);
	eq(items[0].note, undefined);
});

test("parseTodos returns [] on a malformed file rather than throwing", () => {
	eq(parseTodos("not json at all"), []);
	eq(parseTodos("```json\n{ broken \n```"), []);
});

test("buildMarkdown output is a fenced json block that parseTodos reads back", () => {
	const md = buildMarkdown([]);
	ok(md.includes("```json"));
	eq(parseTodos(md), []);
});
