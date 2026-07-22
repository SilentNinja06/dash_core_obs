import { test, eq, is } from "./_harness";
import type { LocalEvent } from "../src/core/localevents";
import { buildLocalEventsMarkdown, parseLocalEvents } from "../src/core/localeventsserde";

test("local-events round-trip preserves timed and all-day events", () => {
	const events: LocalEvent[] = [
		{ id: "e1", date: "2026-07-22", start: "09:00", end: "10:30", summary: "Dentist" },
		{ id: "e2", date: "2026-07-22", summary: "Pay rent" }, // all-day: no start/end
	];
	const restored = parseLocalEvents(buildLocalEventsMarkdown(events));
	eq(restored, events);
});

test("parseLocalEvents reads a raw-JSON body (legacy .json) too", () => {
	const raw = JSON.stringify({ version: 1, events: [{ id: "a", date: "2026-01-01", summary: "New year" }] });
	const events = parseLocalEvents(raw);
	is(events.length, 1);
	is(events[0].summary, "New year");
});

test("parseLocalEvents drops malformed entries and survives junk", () => {
	const raw = buildLocalEventsMarkdown([{ id: "ok", date: "2026-07-22", summary: "Keep me" }]).replace(
		'"events": [',
		'"events": [\n    { "id": 5, "summary": "no date" },\n    null,'
	);
	const events = parseLocalEvents(raw);
	is(events.length, 1);
	is(events[0].id, "ok");
	is(parseLocalEvents("not json at all").length, 0);
});
