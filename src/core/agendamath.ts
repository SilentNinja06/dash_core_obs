/**
 * Next-event / open-gap computation for the agenda (§1.3). Pure and clock-free
 * (all times are passed in) so the "NEXT / NOW / clear" logic can be unit-tested,
 * including the in-progress and all-day cases.
 *
 * Rules:
 *  - All-day events never count as "next" and never consume the gap.
 *  - "NOW" when a timed event has started and not ended; the open gap then begins
 *    at that event's end.
 *  - Otherwise "NEXT" is the first timed event starting strictly after `now`, and
 *    the gap runs from `now` to that start. No upcoming event → the day is clear.
 */

export interface TimedLike {
	summary: string;
	allDay: boolean;
	startMs: number;
	endMs?: number;
}

export interface AgendaState {
	kind: "now" | "next" | "clear";
	/** The event in play, for "now"/"next". */
	summary?: string;
	/** ms until the next event starts ("next") or until the current event ends
	 * ("now"); undefined for "clear". */
	untilMs?: number;
	/** ms of free time from `now` (or the in-progress event's end) to the next
	 * event's start; undefined when the rest of the day is clear. */
	gapMs?: number;
}

/** Compute the agenda placard state from all of a day's items and the current time. */
export function agendaState(items: TimedLike[], now: number): AgendaState {
	const timed = items.filter((i) => !i.allDay).sort((a, b) => a.startMs - b.startMs);

	// In-progress event (started, not yet ended). If several overlap, take the
	// one ending soonest — that's when you are next free.
	const inProgress = timed
		.filter((i) => i.endMs !== undefined && i.startMs <= now && (i.endMs as number) > now)
		.sort((a, b) => (a.endMs as number) - (b.endMs as number))[0];

	const nextEvent = timed.find((i) => i.startMs > now);

	if (inProgress) {
		const gapStart = inProgress.endMs as number;
		return {
			kind: "now",
			summary: inProgress.summary,
			untilMs: gapStart - now,
			gapMs: nextEvent ? Math.max(0, nextEvent.startMs - gapStart) : undefined,
		};
	}

	if (nextEvent) {
		return {
			kind: "next",
			summary: nextEvent.summary,
			untilMs: nextEvent.startMs - now,
			gapMs: nextEvent.startMs - now,
		};
	}

	return { kind: "clear" };
}

/** Human duration like "2h 14m" / "6m" / "less than a minute". */
export function formatGap(ms: number): string {
	const totalMin = Math.floor(Math.max(0, ms) / 60000);
	if (totalMin < 1) return "less than a minute";
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h && m) return `${h}h ${m}m`;
	if (h) return `${h}h`;
	return `${m}m`;
}
