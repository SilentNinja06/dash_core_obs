import { test, eq, is } from "./_harness";
import { buildLayoutMarkdown, layoutHasContent, tryParseLayout } from "../src/core/layoutserde";

test("layout round-trip preserves tabs, assignments, default, and toggle", () => {
	const md = buildLayoutMarkdown({
		mobileTabs: true,
		tabs: [{ id: "t1", name: "Home" }, { id: "t2", name: "Health" }],
		tabAssignments: { clock: "t1", health: "t2" },
		defaultTabId: "t2",
	});
	const res = tryParseLayout(md);
	is(res.ok, true);
	is(res.layout.mobileTabs, true);
	eq(res.layout.tabs, [{ id: "t1", name: "Home" }, { id: "t2", name: "Health" }]);
	eq(res.layout.tabAssignments, { clock: "t1", health: "t2" });
	is(res.layout.defaultTabId, "t2");
});

test("layout round-trip preserves panel order/enable/columns/spans", () => {
	const md = buildLayoutMarkdown({
		panelOrder: ["clock", "music", "todo"],
		enabledPanels: { music: false },
		panelColumns: { todo: 2 },
		panelSpans: { clock: 3 },
	});
	const res = tryParseLayout(md);
	is(res.ok, true);
	eq(res.layout.panelOrder, ["clock", "music", "todo"]);
	eq(res.layout.enabledPanels, { music: false });
	eq(res.layout.panelColumns, { todo: 2 });
	eq(res.layout.panelSpans, { clock: 3 });
});

test("tryParseLayout flags ok:false on unreadable content so callers never clobber it", () => {
	is(tryParseLayout("not json at all").ok, false);
	is(tryParseLayout("```json\n{ broken \n```").ok, false);
	// A JSON array is the wrong top-level shape.
	is(tryParseLayout('```json\n[1,2,3]\n```').ok, false);
});

test("tryParseLayout reads an empty-but-valid object as ok (a device with a file, no tabs yet)", () => {
	const res = tryParseLayout(buildLayoutMarkdown({}));
	is(res.ok, true);
	is(layoutHasContent(res.layout), false);
});

test("tryParseLayout drops malformed tabs and non-string assignments", () => {
	const md = '```json\n{"version":1,"tabs":[{"id":"t1","name":"Home"},{"id":5},"junk"],"tabAssignments":{"clock":"t1","bad":9}}\n```';
	const res = tryParseLayout(md);
	is(res.ok, true);
	eq(res.layout.tabs, [{ id: "t1", name: "Home" }]);
	eq(res.layout.tabAssignments, { clock: "t1" });
});

test("layoutHasContent gates the one-time seed: true only with real config", () => {
	is(layoutHasContent({}), false);
	is(layoutHasContent({ mobileTabs: true }), false); // a bare toggle isn't worth minting a file
	is(layoutHasContent({ tabs: [{ id: "t1", name: "Home" }] }), true);
	is(layoutHasContent({ tabAssignments: { clock: "t1" } }), true);
	is(layoutHasContent({ panelOrder: ["clock"] }), true);
	is(layoutHasContent({ enabledPanels: { music: false } }), true);
});

test("buildLayoutMarkdown writes a single-line JSON object (no shreddable array)", () => {
	const md = buildLayoutMarkdown({ tabs: [{ id: "t1", name: "Home" }] });
	const fence = md.match(/```json\n([\s\S]*?)\n```/)![1];
	eq(fence.split("\n").length, 1);
});

test("tryParseLayout recovers a smart-quote-mangled layout file", () => {
	const good = buildLayoutMarkdown({ tabs: [{ id: "t1", name: "Home" }], defaultTabId: "t1" });
	let flip = 0;
	const mangled = good.replace(/"/g, () => (flip++ % 2 === 0 ? "“" : "”"));
	const res = tryParseLayout(mangled);
	is(res.ok, true);
	eq(res.layout.tabs, [{ id: "t1", name: "Home" }]);
});
