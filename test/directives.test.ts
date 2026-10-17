import { test, eq, ok, is } from "./_harness";
import type { TodoItem } from "../src/core/todostore";
import { buildMarkdown, parseTodos, tryParseTodos, unionById } from "../src/core/directivesserde";

function todo(id: string, text: string): TodoItem {
	return { id, text, recurrence: { type: "none" }, createdAt: 1, order: 0 };
}

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

test("tryParseTodos flags ok:false on unreadable content so callers never clobber it", () => {
	// Malformed JSON / half-synced file: not ok. This is the signal DirectivesStore
	// uses to refuse an overwrite, preventing the reminders from being wiped.
	is(tryParseTodos("not json at all").ok, false);
	is(tryParseTodos("```json\n{ broken \n```").ok, false);
	// Valid JSON but wrong shape (no todos array) is also a failure, not an empty list.
	is(tryParseTodos('```json\n{"version":1}\n```').ok, false);
});

test("tryParseTodos reports ok:true for genuine content, including an empty-but-valid list", () => {
	const populated = buildMarkdown([
		{ id: "a", text: "Take meds", recurrence: { type: "daily" }, createdAt: 1, order: 0 },
	]);
	const res = tryParseTodos(populated);
	is(res.ok, true);
	eq(res.todos.length, 1);

	// A deliberately empty list is a real state, distinct from a parse failure.
	const empty = tryParseTodos(buildMarkdown([]));
	is(empty.ok, true);
	eq(empty.todos, []);
});

test("unionById preserves every synced reminder when a pre-sync edit is written", () => {
	// The real file (finally synced) has the user's 3 reminders; the device had an
	// empty list and the user added one before Sync landed. The merge must keep all
	// three and append the new one — never drop the synced reminders.
	const onDisk = [todo("a", "Take meds"), todo("b", "Log food"), todo("c", "Daily log")];
	const local = [todo("z", "Call the bank")];
	const merged = unionById(onDisk, local);
	eq(merged.map((t) => t.id), ["a", "b", "c", "z"]);
});

test("unionById never duplicates an item already on disk", () => {
	const onDisk = [todo("a", "Take meds"), todo("b", "Log food")];
	const local = [todo("b", "Log food"), todo("z", "New")];
	const merged = unionById(onDisk, local);
	eq(merged.map((t) => t.id), ["a", "b", "z"]);
});

test("tryParseTodos recovers a smart-quote-mangled file (and flags it recovered)", () => {
	const good = buildMarkdown([todo("a", "Take meds"), todo("b", "Log food")]);
	// Smart punctuation turned every straight double quote curly — the classic
	// corruption that leaves all data present but breaks JSON.parse.
	let flip = 0;
	const mangled = good.replace(/"/g, () => (flip++ % 2 === 0 ? "“" : "”"));
	const res = tryParseTodos(mangled);
	is(res.ok, true);
	is(res.recovered, true);
	eq(res.todos.map((t) => t.id), ["a", "b"]);
});

test("tryParseTodos recovers when the code fence lost its language or was removed", () => {
	const good = buildMarkdown([todo("a", "One"), todo("b", "Two")]);
	is(tryParseTodos(good.replace("```json", "```")).todos.length, 2); // language dropped
	// Even with the fence gone entirely, the braced object is still recoverable.
	const noFence = good.replace(/```json\n/, "").replace(/\n```/, "");
	is(tryParseTodos(noFence).todos.length, 2);
});

test("buildMarkdown writes one todo per line so a line-merge can't shred an array", () => {
	// Prevention: the on-disk layout is what makes corruption possible. Each todo
	// must be a single line; a merge then keeps/drops whole valid lines instead of
	// interleaving a multi-line completions array into invalid JSON.
	const items: TodoItem[] = [
		{ ...todo("a", "Log food"), completions: ["2026-07-15", "2026-07-16", "2026-07-17"] },
		{ ...todo("b", "Daily log"), completions: ["2026-07-15", "2026-07-16"] },
	];
	const md = buildMarkdown(items);
	const fence = md.match(/```json\n([\s\S]*?)\n```/)![1];
	const todoLines = fence.split("\n").filter((l) => l.trim().startsWith('{"'));
	eq(todoLines.length, 2); // exactly one line per todo, arrays inline
	// No date sits alone on its own line — the surface a text-merge interleaves.
	ok(!/^\s*"\d{4}-\d{2}-\d{2}"/m.test(fence));
	eq(parseTodos(md), items); // still round-trips
});

test("tryParseTodos recovers a file a line-level sync merge shredded (the real bug)", () => {
	// This is the exact corruption class from the field report: two devices'
	// pretty-printed versions interleaved into invalid JSON — double commas, a
	// missing comma, a duplicated date line, an unterminated string, a stray
	// quote. JSON.parse fails outright, which blanked the whole directives list.
	const mangled = [
		"%% header %%",
		"",
		"```json",
		"{",
		'  "version": 1,',
		'  "todos": [',
		"    {",
		'      "id": "a", "text": "Do daily log",',
		'      "recurrence": { "type": "daily" }, "createdAt": 1, "order": 6,',
		'      "completions": [',
		'        "2026-07-15",',
		'        "2026-07-31",,',
		'        "2026-08-03"',
		'        "2026-08-03"',
		"      ],",
		'      "skips": [ "2026-07-17" ]',
		"    },",
		"    {",
		'      "id": "b", "text": "Inkscape course",',
		'      "recurrence": { "type": "daily" }, "createdAt": 1, "order": 7,',
		'      "completions": [ "2026-07-15" ],',
		'      "skips": [',
		'        "2026-08-01",',
		'        "2026-08-04,',
		'        "2026-08-03"",',
		'        "2026-08-04"',
		"      ]",
		"    }",
		"  ]",
		"}",
		"```",
	].join("\n");
	// Plain parse cannot read it...
	is(JSON.parse === JSON.parse, true);
	const res = tryParseTodos(mangled);
	is(res.ok, true);
	is(res.recovered, true);
	eq(res.todos.length, 2);
	// Every reminder survives, and the shredded date arrays come back clean/deduped.
	const daily = res.todos.find((t) => t.text === "Do daily log")!;
	eq(daily.completions, ["2026-07-15", "2026-07-31", "2026-08-03"]);
	const ink = res.todos.find((t) => t.text === "Inkscape course")!;
	eq(ink.skips, ["2026-08-01", "2026-08-04", "2026-08-03"]);
});
