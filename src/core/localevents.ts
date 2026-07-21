import type { AgendaItem } from "./ics";

/**
 * Local events (§2.1): schedule entries the read-only calendar subscription will never
 * carry, entered on the dashboard and merged into today's agenda. Purely
 * dashboard state — never written to the daily note or any ICS.
 */
export interface LocalEvent {
	id: string;
	date: string; // YYYY-MM-DD
	start?: string; // HH:mm — absent means all-day
	end?: string; // HH:mm
	summary: string;
}

/** Convert a local event into an AgendaItem so it merges into the same sorted
 * list and feeds the next-event / gap math exactly like a fetched event. Pure
 * (native Date, local wall-clock) so it stays testable. */
export function localEventToAgendaItem(ev: LocalEvent): AgendaItem {
	const [y, mo, d] = ev.date.split("-").map(Number);
	if (!ev.start) {
		return {
			summary: ev.summary || "(untitled)",
			location: "",
			allDay: true,
			startMs: new Date(y, mo - 1, d).getTime(),
			timeLabel: "",
			sortKey: -1,
		};
	}
	const [sh, sm] = ev.start.split(":").map(Number);
	const startMs = new Date(y, mo - 1, d, sh, sm).getTime();
	let endMs: number | undefined;
	let timeLabel = ev.start;
	if (ev.end) {
		const [eh, em] = ev.end.split(":").map(Number);
		endMs = new Date(y, mo - 1, d, eh, em).getTime();
		timeLabel += `–${ev.end}`;
	}
	return {
		summary: ev.summary || "(untitled)",
		location: "",
		allDay: false,
		startMs,
		endMs,
		timeLabel,
		sortKey: sh * 60 + sm,
	};
}
