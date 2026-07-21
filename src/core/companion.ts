/**
 * The capability interface a host implements to feed companion-plugin data into
 * generic core panels (e.g. the weekly review, the meals panel) *without* core
 * ever naming a specific plugin id. Every method is optional: a host that lacks a
 * companion simply omits it, and the consuming panel shows fewer rows / a graceful
 * empty state — no code change.
 *
 * This is the lore-free half of what used to be the entangled `bridge.ts`. The
 * companion *readers* (which know plugin ids like `arfid-tracker`, markdown
 * fallbacks, etc.) stay in each host; they adapt themselves to this shape.
 */

/** A planned meal: display name + link target. */
export interface Meal {
	name: string;
	link: string;
}

/** One checkbox row in a grocery list. */
export interface GroceryItem {
	name: string;
	checked: boolean;
	/** 0-based line index in the grocery file (for inline toggling). */
	line: number;
}

/** A grocery list read from a vault file. */
export interface GroceryList {
	path: string;
	items: GroceryItem[];
	/** Whether the list file exists. */
	exists: boolean;
}

export interface CompanionData {
	/** Count of regulation entries logged for `date` (counts only, never content). */
	spiralEntriesForDate?(date: string): number | Promise<number>;
	/** Count of nourishment/food entries logged for `date`. */
	nourishmentEntriesForDate?(date: string): number | Promise<number>;
	/** Contacts reached on `date`, as display name + vault link. */
	contactsReachedForDate?(date: string): { name: string; link: string }[] | Promise<{ name: string; link: string }[]>;

	// --- meals / provisioning (a recipe-plugin companion) ---
	/** Whether a recipe/meal companion is available. Absent or false → the meals
	 * panel shows its offline state. */
	recipesAvailable?(): boolean;
	/** Meals planned for `date` (default today). */
	plannedMeals?(date?: string): Promise<Meal[]>;
	/** The current grocery list. */
	groceryList?(): Promise<GroceryList>;
	/** Toggle the checkbox on grocery line `line`, writing back to the file. */
	toggleGroceryItem?(line: number): Promise<void>;
}
