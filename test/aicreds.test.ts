import { test, eq, is } from "./_harness";
import { buildAICredsMarkdown, tryParseAICreds } from "../src/core/aicredsserde";

test("AI creds round-trip preserves the key and base URL", () => {
	const md = buildAICredsMarkdown({ apiKey: "sk-ant-abc123", baseUrl: "https://api.example.com/v1" });
	const res = tryParseAICreds(md);
	is(res.ok, true);
	is(res.creds.apiKey, "sk-ant-abc123");
	is(res.creds.baseUrl, "https://api.example.com/v1");
});

test("AI creds round-trip works with no base URL (Anthropic)", () => {
	const md = buildAICredsMarkdown({ apiKey: "sk-ant-xyz" });
	const res = tryParseAICreds(md);
	is(res.ok, true);
	is(res.creds.apiKey, "sk-ant-xyz");
	is(res.creds.baseUrl, undefined);
});

test("tryParseAICreds flags ok:false on unreadable content so callers never clobber it", () => {
	is(tryParseAICreds("not json at all").ok, false);
	is(tryParseAICreds("```json\n{ broken \n```").ok, false);
	// Valid JSON but wrong shape (no string apiKey) is a failure, not an empty key.
	is(tryParseAICreds('```json\n{"version":1}\n```').ok, false);
});

test("tryParseAICreds reads an empty-but-valid key (a deliberate clear) as ok", () => {
	const res = tryParseAICreds(buildAICredsMarkdown({ apiKey: "" }));
	is(res.ok, true);
	is(res.creds.apiKey, "");
});

test("tryParseAICreds recovers a smart-quote-mangled credentials file", () => {
	const good = buildAICredsMarkdown({ apiKey: "sk-ant-abc" });
	let flip = 0;
	const mangled = good.replace(/"/g, () => (flip++ % 2 === 0 ? "“" : "”"));
	const res = tryParseAICreds(mangled);
	is(res.ok, true);
	is(res.creds.apiKey, "sk-ant-abc");
});

test("buildAICredsMarkdown writes a single-line JSON object (no shreddable array)", () => {
	const md = buildAICredsMarkdown({ apiKey: "k", baseUrl: "u" });
	const fence = md.match(/```json\n([\s\S]*?)\n```/)![1];
	eq(fence.split("\n").length, 1);
});
