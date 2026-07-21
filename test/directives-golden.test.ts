import { test, is } from "./_harness";
import type { TodoItem } from "../src/core/todostore";
import { buildMarkdown, parseTodos } from "../src/core/directivesserde";

/**
 * A.7 golden-file guard. The directives file syncs across devices via Obsidian
 * Sync, so its on-disk JSON-in-Markdown byte format must not drift when the
 * serializer moves into core — an existing vault's file must keep parsing, and
 * a re-serialize must produce identical bytes. This test pins the exact bytes
 * for a representative item (with sub-items, per-occurrence sub-completions, and
 * a note) written with a host-supplied header, and asserts parse→serialize is
 * byte-identical. If JSON.stringify options, fencing, or header placement ever
 * change, this fails loudly.
 */

// A host's voiced header (here, MERIDIAN's) is passed in — core stays lore-free.
const HEADER =
	"%% MERIDIAN Dashboard — persistent directives. Managed automatically; " +
	"edit these in the dashboard, not here. %%";

const ITEMS: TodoItem[] = [
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
		subItems: [{ id: "s1", text: "Tidy inbox", done: false }],
		subCompletions: { "2026-07-20": ["s1"] },
	},
];

const GOLDEN =
	"%% MERIDIAN Dashboard — persistent directives. Managed automatically; edit these in the dashboard, not here. %%\n\n```json\n{\n  \"version\": 1,\n  \"todos\": [\n    {\n      \"id\": \"t1\",\n      \"text\": \"Weekly review\",\n      \"recurrence\": {\n        \"type\": \"weekly\",\n        \"days\": [\n          1\n        ]\n      },\n      \"createdAt\": 1700000000000,\n      \"order\": 0,\n      \"scheduledTime\": \"09:00\",\n      \"dueDate\": \"2026-07-24\",\n      \"showOnWeekPrint\": true,\n      \"completions\": [\n        \"2026-07-20\"\n      ],\n      \"skips\": [],\n      \"note\": \"Bring the printed planner.\",\n      \"subItems\": [\n        {\n          \"id\": \"s1\",\n          \"text\": \"Tidy inbox\",\n          \"done\": false\n        }\n      ],\n      \"subCompletions\": {\n        \"2026-07-20\": [\n          \"s1\"\n        ]\n      }\n    }\n  ]\n}\n```\n";

test("golden: buildMarkdown emits the exact locked bytes for a host header", () => {
	is(buildMarkdown(ITEMS, HEADER), GOLDEN);
});

test("golden: parse → re-serialize is byte-identical to the on-disk file", () => {
	is(buildMarkdown(parseTodos(GOLDEN), HEADER), GOLDEN);
});

test("golden: a file written with a different header still parses identically", () => {
	// An existing vault file (any header) must still round-trip its data.
	const neutral = buildMarkdown(ITEMS); // default neutral header
	is(buildMarkdown(parseTodos(neutral), HEADER), GOLDEN);
});
