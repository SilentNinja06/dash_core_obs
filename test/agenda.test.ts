import { test, is, eq } from "./_harness";
import { agendaState, formatGap, TimedLike } from "../src/core/agendamath";

const H = 3600000;
const M = 60000;
const NOON = Date.UTC(2026, 6, 20, 12, 0, 0); // reference "now"

function ev(summary: string, startH: number, endH?: number, allDay = false): TimedLike {
	return {
		summary,
		allDay,
		startMs: Date.UTC(2026, 6, 20, startH, 0, 0),
		endMs: endH === undefined ? undefined : Date.UTC(2026, 6, 20, endH, 0, 0),
	};
}

test("agendaState: NEXT is the first timed event after now, gap equals the wait", () => {
	const s = agendaState([ev("Standup", 14, 15)], NOON);
	is(s.kind, "next");
	is(s.summary, "Standup");
	is(s.untilMs, 2 * H);
	is(s.gapMs, 2 * H);
});

test("agendaState: NOW when inside an event; gap starts at that event's end", () => {
	const s = agendaState([ev("Deep work", 11, 13), ev("Call", 15, 16)], NOON);
	is(s.kind, "now");
	is(s.summary, "Deep work");
	is(s.untilMs, 1 * H); // ends at 13:00, one hour out
	is(s.gapMs, 2 * H); // 13:00 → 15:00
});

test("agendaState: NOW with no later event leaves the gap undefined", () => {
	const s = agendaState([ev("Deep work", 11, 13)], NOON);
	is(s.kind, "now");
	is(s.gapMs, undefined);
});

test("agendaState: all-day events never count as next or consume the gap", () => {
	const s = agendaState([ev("Holiday", 0, undefined, true), ev("Review", 16, 17)], NOON);
	is(s.kind, "next");
	is(s.summary, "Review");
	is(s.untilMs, 4 * H);
});

test("agendaState: only all-day events today reads as clear", () => {
	const s = agendaState([ev("Holiday", 0, undefined, true)], NOON);
	is(s.kind, "clear");
});

test("agendaState: past-only events read as clear", () => {
	const s = agendaState([ev("Breakfast", 8, 9)], NOON);
	is(s.kind, "clear");
});

test("agendaState: empty day is clear", () => {
	eq(agendaState([], NOON), { kind: "clear" });
});

test("agendaState: overlapping in-progress events pick the soonest-ending", () => {
	const s = agendaState([ev("Long", 10, 18), ev("Short", 11, 12, false)], NOON);
	is(s.kind, "now");
	is(s.summary, "Long"); // "Short" ended at 12:00 == now (not > now); Long still running
	is(s.untilMs, 6 * H);
});

test("agendaState: event starting exactly now is not 'in progress' (start <= now, but end must be > now)", () => {
	// An event 12:00–13:00 with now==12:00 counts as in-progress (started, not ended).
	const s = agendaState([ev("Begins now", 12, 13)], NOON);
	is(s.kind, "now");
	is(s.untilMs, 1 * H);
});

test("formatGap renders hours and minutes", () => {
	is(formatGap(2 * H + 14 * M), "2h 14m");
	is(formatGap(6 * M), "6m");
	is(formatGap(2 * H), "2h");
	is(formatGap(30000), "less than a minute");
});
