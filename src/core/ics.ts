import { moment, requestUrl } from "obsidian";

/**
 * A small, focused ICS (RFC 5545) reader for the agenda panel (§7.5). It fetches
 * with `requestUrl` (CORS-free on desktop and mobile), parses VEVENTs, and
 * answers one question well: *what is on for this local calendar day.* It
 * handles line folding, all-day (VALUE=DATE) vs timed events, TZID / UTC /
 * floating times, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, BYDAY,
 * BYMONTHDAY, COUNT, UNTIL), EXDATE exclusions, and RECURRENCE-ID overrides.
 *
 * It is deliberately scoped to "today" — no month view (explicitly not wanted).
 */

export interface AgendaItem {
	summary: string;
	location: string;
	allDay: boolean;
	/** Epoch ms of the occurrence start (timed events only). */
	startMs: number;
	/** Epoch ms of the occurrence end (timed events with a DTEND only); undefined
	 * for all-day events and events with no end. Drives the next-event / gap
	 * math and the in-progress ("NOW") case (§1.3). */
	endMs?: number;
	/** "HH:mm"–"HH:mm" for timed events, "" for all-day. */
	timeLabel: string;
	/** For sorting within the day. All-day sorts first. */
	sortKey: number;
}

interface DateVal {
	allDay: boolean;
	y: number;
	mo: number; // 1-12
	d: number;
	h: number;
	mi: number;
	s: number;
	zone: "utc" | "local" | string; // IANA tz name, or utc/local
}

interface RRule {
	freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
	interval: number;
	count?: number;
	until?: DateVal;
	byday?: number[]; // 0=Sun..6=Sat
	bymonthday?: number[];
}

interface VEvent {
	uid: string;
	summary: string;
	location: string;
	start: DateVal;
	end?: DateVal;
	rrule?: RRule;
	exdates: Set<string>; // canonical YYYY-MM-DD of excluded occurrences
	recurrenceId?: string; // YYYY-MM-DD this event overrides
}

// ------------------------------------------------------------- timezones

/** Offset (minutes to add to UTC to get local wall time) for `tz` at `utcMs`. */
function tzOffsetMinutes(tz: string, utcMs: number): number {
	try {
		const dtf = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		const parts = dtf.formatToParts(new Date(utcMs));
		const map: Record<string, number> = {};
		for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
		const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
		return (asUTC - utcMs) / 60000;
	} catch {
		return 0; // unknown zone → treat as UTC
	}
}

/** Convert wall-clock components in a zone to an epoch ms instant. */
function toEpochMs(v: DateVal): number {
	if (v.zone === "utc") return Date.UTC(v.y, v.mo - 1, v.d, v.h, v.mi, v.s);
	if (v.zone === "local") return new Date(v.y, v.mo - 1, v.d, v.h, v.mi, v.s).getTime();
	// Named IANA zone: two-pass to settle DST boundaries.
	const guess = Date.UTC(v.y, v.mo - 1, v.d, v.h, v.mi, v.s);
	let off = tzOffsetMinutes(v.zone, guess);
	let utc = guess - off * 60000;
	off = tzOffsetMinutes(v.zone, utc);
	utc = guess - off * 60000;
	return utc;
}

// --------------------------------------------------------------- parsing

/** Unfold RFC 5545 folded lines (continuations begin with space or tab). */
function unfold(text: string): string[] {
	const raw = text.replace(/\r\n/g, "\n").split("\n");
	const out: string[] = [];
	for (const line of raw) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

function parseDateVal(rawKey: string, value: string): DateVal {
	// rawKey may include params, e.g. DTSTART;TZID=America/New_York;VALUE=DATE
	const params = rawKey.split(";").slice(1);
	let tzid = "";
	let isDate = false;
	for (const p of params) {
		const [k, v] = p.split("=");
		if (k.toUpperCase() === "TZID") tzid = v;
		if (k.toUpperCase() === "VALUE" && v.toUpperCase() === "DATE") isDate = true;
	}
	const v = value.trim();
	if (isDate || /^\d{8}$/.test(v)) {
		return {
			allDay: true,
			y: +v.slice(0, 4),
			mo: +v.slice(4, 6),
			d: +v.slice(6, 8),
			h: 0,
			mi: 0,
			s: 0,
			zone: "local",
		};
	}
	const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
	if (!m) {
		// Fallback: let moment try, treat as local.
		const mm = moment(v);
		return { allDay: false, y: mm.year(), mo: mm.month() + 1, d: mm.date(), h: mm.hour(), mi: mm.minute(), s: mm.second(), zone: "local" };
	}
	const zone = m[7] ? "utc" : tzid || "local";
	return { allDay: false, y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6], zone };
}

const WEEKDAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(value: string): RRule | undefined {
	const parts: Record<string, string> = {};
	for (const seg of value.split(";")) {
		const [k, v] = seg.split("=");
		if (k && v) parts[k.toUpperCase()] = v;
	}
	const freq = parts.FREQ as RRule["freq"];
	if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return undefined;
	const rule: RRule = { freq, interval: Math.max(1, Number(parts.INTERVAL) || 1) };
	if (parts.COUNT) rule.count = Number(parts.COUNT);
	if (parts.UNTIL) rule.until = parseDateVal("UNTIL", parts.UNTIL);
	if (parts.BYDAY) {
		rule.byday = parts.BYDAY.split(",")
			.map((c) => WEEKDAY_CODES[c.replace(/^[+-]?\d+/, "").toUpperCase()])
			.filter((n) => n !== undefined);
	}
	if (parts.BYMONTHDAY) rule.bymonthday = parts.BYMONTHDAY.split(",").map(Number);
	return rule;
}

export function parseICS(text: string): VEvent[] {
	const lines = unfold(text);
	const events: VEvent[] = [];
	let cur: Partial<VEvent> | null = null;
	for (const line of lines) {
		if (line === "BEGIN:VEVENT") {
			cur = { summary: "", location: "", uid: "", exdates: new Set() };
			continue;
		}
		if (line === "END:VEVENT") {
			if (cur && cur.start) events.push(cur as VEvent);
			cur = null;
			continue;
		}
		if (!cur) continue;
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const rawKey = line.slice(0, idx);
		const value = line.slice(idx + 1);
		const key = rawKey.split(";")[0].toUpperCase();
		switch (key) {
			case "UID":
				cur.uid = value.trim();
				break;
			case "SUMMARY":
				cur.summary = unescapeText(value);
				break;
			case "LOCATION":
				cur.location = unescapeText(value);
				break;
			case "DTSTART":
				cur.start = parseDateVal(rawKey, value);
				break;
			case "DTEND":
				cur.end = parseDateVal(rawKey, value);
				break;
			case "RRULE":
				cur.rrule = parseRRule(value);
				break;
			case "EXDATE": {
				for (const piece of value.split(",")) {
					const dv = parseDateVal(rawKey, piece);
					cur.exdates!.add(canonicalDate(dv));
				}
				break;
			}
			case "RECURRENCE-ID": {
				cur.recurrenceId = canonicalDate(parseDateVal(rawKey, value));
				break;
			}
		}
	}
	return events;
}

function unescapeText(v: string): string {
	return v
		.replace(/\\n/gi, "\n")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\")
		.trim();
}

function canonicalDate(v: DateVal): string {
	return `${pad4(v.y)}-${pad2(v.mo)}-${pad2(v.d)}`;
}
function pad2(n: number): string {
	return String(n).padStart(2, "0");
}
function pad4(n: number): string {
	return String(n).padStart(4, "0");
}

// -------------------------------------------------------- occurrence math

/** All occurrence start DateVals of `ev` that land on `targetDate` (local). */
function occurrencesOn(ev: VEvent, targetDate: string): DateVal[] {
	const start = ev.start;
	const localDateOf = (v: DateVal): string =>
		v.allDay ? canonicalDate(v) : moment(toEpochMs(v)).format("YYYY-MM-DD");

	if (!ev.rrule) {
		// Single event. Include if it starts today, or (for multi-day) spans today.
		if (localDateOf(start) === targetDate) return [start];
		if (ev.end && spansDate(ev, targetDate)) return [start];
		return [];
	}

	const rule = ev.rrule;
	const results: DateVal[] = [];
	const targetEndMs = moment(targetDate, "YYYY-MM-DD").endOf("day").valueOf();
	const untilMs = rule.until ? toEpochMs(rule.until) : Infinity;
	let emitted = 0;
	const guard = 20000;

	const cursor = { y: start.y, mo: start.mo, d: start.d };
	for (let i = 0; i < guard; i++) {
		// Build the set of candidate day-tuples for this period (BYDAY expands weeks).
		const candidates = expandPeriod(rule, cursor, start);
		for (const cand of candidates) {
			const occ: DateVal = { ...start, y: cand.y, mo: cand.mo, d: cand.d };
			const occMs = occ.allDay ? Date.UTC(occ.y, occ.mo - 1, occ.d) : toEpochMs(occ);
			if (compareTuple(cand, { y: start.y, mo: start.mo, d: start.d }) < 0) continue; // before DTSTART
			if (occMs > untilMs && rule.until) return results;
			if (ev.exdates.has(canonicalDate(occ))) continue;
			emitted++;
			if (localDateOf(occ) === targetDate) results.push(occ);
			if (rule.count && emitted >= rule.count) return results;
		}
		advancePeriod(rule, cursor);
		const cursorStartMs = Date.UTC(cursor.y, cursor.mo - 1, cursor.d);
		// Slack of a full week + a day: for WEEKLY/BYDAY the cursor weekday can
		// sit several days *after* an earlier BYDAY occurrence in the same week,
		// so we must not stop until the whole containing week is behind us.
		if (cursorStartMs > targetEndMs + 8 * 86400000) break;
	}
	return results;
}

interface Tuple {
	y: number;
	mo: number;
	d: number;
}

function expandPeriod(rule: RRule, cursor: Tuple, start: DateVal): Tuple[] {
	if (rule.freq === "WEEKLY" && rule.byday && rule.byday.length) {
		// Emit each requested weekday within the cursor's week (week starts Sun).
		const base = new Date(Date.UTC(cursor.y, cursor.mo - 1, cursor.d));
		const dow = base.getUTCDay();
		const weekStart = new Date(base.getTime() - dow * 86400000);
		return rule.byday
			.slice()
			.sort((a, b) => a - b)
			.map((wd) => {
				const dt = new Date(weekStart.getTime() + wd * 86400000);
				return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
			});
	}
	if (rule.freq === "MONTHLY" && rule.bymonthday && rule.bymonthday.length) {
		return rule.bymonthday.map((md) => clampDay({ y: cursor.y, mo: cursor.mo, d: md }));
	}
	return [{ y: cursor.y, mo: cursor.mo, d: cursor.d }];
}

function advancePeriod(rule: RRule, cursor: Tuple): void {
	const step = rule.interval;
	if (rule.freq === "DAILY") {
		const dt = new Date(Date.UTC(cursor.y, cursor.mo - 1, cursor.d + step));
		assign(cursor, dt);
	} else if (rule.freq === "WEEKLY") {
		const dt = new Date(Date.UTC(cursor.y, cursor.mo - 1, cursor.d + 7 * step));
		assign(cursor, dt);
	} else if (rule.freq === "MONTHLY") {
		let mo = cursor.mo - 1 + step;
		let y = cursor.y + Math.floor(mo / 12);
		mo = ((mo % 12) + 12) % 12;
		cursor.y = y;
		cursor.mo = mo + 1;
		// keep day; clamped at read time
	} else {
		cursor.y += step;
	}
}

function assign(cursor: Tuple, dt: Date): void {
	cursor.y = dt.getUTCFullYear();
	cursor.mo = dt.getUTCMonth() + 1;
	cursor.d = dt.getUTCDate();
}

function clampDay(t: Tuple): Tuple {
	const dim = new Date(Date.UTC(t.y, t.mo, 0)).getUTCDate();
	return { y: t.y, mo: t.mo, d: Math.min(t.d, dim) };
}

function compareTuple(a: Tuple, b: Tuple): number {
	return a.y - b.y || a.mo - b.mo || a.d - b.d;
}

function spansDate(ev: VEvent, targetDate: string): boolean {
	if (!ev.end) return false;
	const startDay = ev.start.allDay ? canonicalDate(ev.start) : moment(toEpochMs(ev.start)).format("YYYY-MM-DD");
	const endMs = ev.end.allDay
		? moment(canonicalDate(ev.end), "YYYY-MM-DD").valueOf() // DTEND all-day is exclusive
		: toEpochMs(ev.end);
	const targetStartMs = moment(targetDate, "YYYY-MM-DD").startOf("day").valueOf();
	const startMs = ev.start.allDay ? moment(startDay, "YYYY-MM-DD").valueOf() : toEpochMs(ev.start);
	return startMs <= moment(targetDate, "YYYY-MM-DD").endOf("day").valueOf() && endMs > targetStartMs;
}

/** All agenda items for `localDate` across the given events, sorted. RECURRENCE-ID
 * override events replace the base occurrence they point at. */
export function eventsOnDate(events: VEvent[], localDate: string): AgendaItem[] {
	// Occurrences overridden by a RECURRENCE-ID event, keyed by uid|date.
	const overridden = new Set<string>();
	for (const ev of events) if (ev.recurrenceId) overridden.add(`${ev.uid}|${ev.recurrenceId}`);

	const items: AgendaItem[] = [];
	for (const ev of events) {
		const occs = ev.recurrenceId
			? occurrencesOn(ev, localDate) // an override is itself a single event
			: occurrencesOn(ev, localDate).filter(
					(o) => !overridden.has(`${ev.uid}|${canonicalDate(o)}`)
			  );
		for (const occ of occs) items.push(toAgendaItem(ev, occ));
	}
	items.sort((a, b) => a.sortKey - b.sortKey || a.summary.localeCompare(b.summary));
	return items;
}

function toAgendaItem(ev: VEvent, occ: DateVal): AgendaItem {
	if (occ.allDay) {
		return {
			summary: ev.summary || "(untitled)",
			location: ev.location,
			allDay: true,
			startMs: moment(canonicalDate(occ), "YYYY-MM-DD").valueOf(),
			timeLabel: "",
			sortKey: -1,
		};
	}
	const startMs = toEpochMs(occ);
	const startM = moment(startMs);
	let timeLabel = startM.format("HH:mm");
	let endMs: number | undefined;
	if (ev.end && !ev.end.allDay) {
		// End of this occurrence = start + original duration.
		const origStart = toEpochMs(ev.start);
		const origEnd = toEpochMs(ev.end);
		const durMs = Math.max(0, origEnd - origStart);
		endMs = startMs + durMs;
		timeLabel += `–${moment(endMs).format("HH:mm")}`;
	}
	return {
		summary: ev.summary || "(untitled)",
		location: ev.location,
		allDay: false,
		startMs,
		endMs,
		timeLabel,
		sortKey: startM.hour() * 60 + startM.minute(),
	};
}

// ----------------------------------------------------------------- fetch

/** Fetch raw ICS text via requestUrl (CORS-free, desktop + mobile). Throws on
 * network/HTTP failure so the caller can surface it (§7.5). */
export async function fetchICS(url: string): Promise<string> {
	const res = await requestUrl({ url, method: "GET", throw: false });
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`HTTP ${res.status}`);
	}
	return res.text;
}
