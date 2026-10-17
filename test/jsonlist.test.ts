import { test, eq, is, ok } from "./_harness";
import { buildListMarkdown, tryParseList, unionRecordsById } from "../src/core/jsonlistserde";

interface Rec {
	id: string;
	name: string;
	tags?: string[];
}
const HEADER = "%% Test — records. %%";

test("json-list round-trip preserves records and inline arrays", () => {
	const recs: Rec[] = [
		{ id: "a", name: "One", tags: ["x", "y"] },
		{ id: "b", name: "Two" },
	];
	const res = tryParseList<Rec>(buildListMarkdown(recs, HEADER));
	is(res.ok, true);
	eq(res.records, recs);
});

test("json-list writes one record per line so a merge can't shred it", () => {
	const md = buildListMarkdown([{ id: "a", name: "One", tags: ["x", "y", "z"] }], HEADER);
	const fence = md.match(/```json\n([\s\S]*?)\n```/)![1];
	const recordLines = fence.split("\n").filter((l) => l.trim().startsWith('{"'));
	eq(recordLines.length, 1); // arrays inline on the record's single line
	ok(!/^\s*"[xyz]"/m.test(fence)); // no array element alone on its own line
});

test("tryParseList flags ok:false on unreadable content so callers never clobber", () => {
	is(tryParseList("not json").ok, false);
	is(tryParseList("```json\n{ broken \n```").ok, false);
	is(tryParseList('```json\n{"version":1}\n```').ok, false); // valid JSON, wrong shape
});

test("tryParseList reads an empty-but-valid list as ok (distinct from failure)", () => {
	const res = tryParseList(buildListMarkdown([], HEADER));
	is(res.ok, true);
	eq(res.records, []);
});

test("tryParseList drops malformed entries via the validity predicate", () => {
	const raw = `%% h %%\n\n\`\`\`json\n${JSON.stringify({
		version: 1,
		records: [{ id: "a", name: "ok" }, { id: 5, name: "bad-id" }, { name: "no-id" }, "junk"],
	})}\n\`\`\`\n`;
	const isRec = (r: unknown): r is Rec =>
		!!r && typeof r === "object" && typeof (r as Rec).id === "string" && typeof (r as Rec).name === "string";
	const res = tryParseList<Rec>(raw, isRec);
	is(res.ok, true);
	eq(res.records.map((r) => r.id), ["a"]);
});

test("tryParseList recovers a smart-quote-mangled file and flags recovered", () => {
	const good = buildListMarkdown([{ id: "a", name: "One" }], HEADER);
	let flip = 0;
	const mangled = good.replace(/"/g, () => (flip++ % 2 === 0 ? "“" : "”"));
	const res = tryParseList<Rec>(mangled);
	is(res.ok, true);
	is(res.recovered, true);
	eq(res.records.map((r) => r.id), ["a"]);
});

test("unionRecordsById keeps every synced record and appends a pre-load add", () => {
	const onDisk: Rec[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
	const local: Rec[] = [{ id: "z", name: "Z" }];
	eq(unionRecordsById(onDisk, local).map((r) => r.id), ["a", "b", "z"]);
	// never duplicates a shared id
	eq(unionRecordsById(onDisk, [{ id: "b", name: "B" }, { id: "z", name: "Z" }]).map((r) => r.id), ["a", "b", "z"]);
});
