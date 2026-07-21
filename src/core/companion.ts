/**
 * The capability interface a host implements to feed companion-plugin data into
 * generic core panels (e.g. the weekly review) *without* core ever naming a
 * specific plugin id. Every method is optional: a host that lacks a companion
 * simply omits it, and the consuming panel shows fewer rows — no code change.
 *
 * This is the lore-free half of what used to be the entangled `bridge.ts`. The
 * companion *readers* (which know plugin ids like `arfid-tracker`, markdown
 * fallbacks, etc.) stay in each host; they adapt themselves to this shape.
 */
export interface CompanionData {
	/** Count of regulation entries logged for `date` (counts only, never content). */
	spiralEntriesForDate?(date: string): number | Promise<number>;
	/** Count of nourishment/food entries logged for `date`. */
	nourishmentEntriesForDate?(date: string): number | Promise<number>;
	/** Contacts reached on `date`, as display name + vault link. */
	contactsReachedForDate?(date: string): { name: string; link: string }[] | Promise<{ name: string; link: string }[]>;
}
