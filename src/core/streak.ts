/**
 * Observation streak (§2.2): a genuine longevity metric and honest milestone
 * trigger. The current streak is derived by scanning the daily notes backward
 * from today (see the host's streak recompute) rather than accumulated
 * incrementally — that makes it self-healing and robust to *when* it recomputes.
 *
 * `currentStreakFromDays` is the pure counting rule, unit-tested for the
 * consecutive / broken / today-in-progress cases. A broken streak is silent —
 * it just yields a smaller number and produces no negative copy anywhere.
 */
export interface StreakData {
	current: number;
	longest: number;
	/** YYYY-MM-DD of the day the streak was last locked in (today, once today has
	 * earned its mark), or "" if none yet. Guards the once-per-day recompute. */
	lastDayCounted: string;
}

export const DEFAULT_STREAK: StreakData = { current: 0, longest: 0, lastDayCounted: "" };

/**
 * Count the current streak from a backward day-count array where index 0 is
 * today, index 1 yesterday, and so on. A not-yet-qualified today does not break
 * a live streak: if today hasn't counted, the run is measured from yesterday, so
 * the display stays correct between midnight and the day's first logged activity.
 */
export function currentStreakFromDays(counts: boolean[]): number {
	const start = counts[0] ? 0 : 1;
	let n = 0;
	for (let i = start; i < counts.length; i++) {
		if (!counts[i]) break;
		n++;
	}
	return n;
}
