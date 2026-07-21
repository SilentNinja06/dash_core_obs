import { TFile } from "obsidian";
import { BasePanel, placard } from "./types";
import { commandButton } from "./util";

/**
 * Meals + grocery panel. Renders today's planned recipes as cards with links, and
 * the current grocery list checkable inline (writing back through the companion),
 * plus companion command buttons. All companion data comes through `ctx.companion`
 * (core names no recipe plugin); every string and command id is host-injected via
 * `MealsCopy`.
 */

/** One companion command button (id + label are host-supplied). */
export interface MealsCommand {
	id: string;
	label: string;
	cls?: string;
	/** Whether pressing it counts as a food interaction (nudges `markFoodFocus`). */
	food?: boolean;
}

/** Host-injected copy for the meals panel. Templates: `noGroceryAt` uses `{path}`;
 * `remaining` uses `{remaining}` and `{total}`. */
export interface MealsCopy {
	title: string;
	offline: string;
	plannedHeading: string;
	noMeals: string;
	openRecipe: string;
	groceryHeading: string;
	noGroceryAt: string;
	groceryEmpty: string;
	remaining: string;
	commandOffline: string;
	commands: MealsCommand[];
}

export class MealsPanel extends BasePanel {
	id = "meals";
	title: string;

	constructor(private copy: MealsCopy) {
		super();
		this.title = copy.title;
	}

	protected async renderBody(): Promise<void> {
		const companion = this.ctx.companion;
		placard(this.el, this.copy.title);

		if (!companion.recipesAvailable?.()) {
			this.el.createDiv({ cls: "dash-muted", text: this.copy.offline });
			return;
		}

		// --- today's meals ---
		const meals = (await companion.plannedMeals?.()) ?? [];
		const mealsWrap = this.el.createDiv({ cls: "dash-meals" });
		mealsWrap.createDiv({ cls: "dash-subhead", text: this.copy.plannedHeading });
		if (meals.length === 0) {
			mealsWrap.createDiv({ cls: "dash-muted", text: this.copy.noMeals });
		} else {
			const cards = mealsWrap.createDiv({ cls: "dash-meal-cards" });
			for (const meal of meals) {
				const card = cards.createDiv({ cls: "dash-meal-card" });
				card.createDiv({ cls: "dash-meal-name", text: meal.name });
				card.createDiv({ cls: "dash-meal-open", text: this.copy.openRecipe });
				card.addEventListener("click", () => {
					const dest = this.ctx.app.metadataCache.getFirstLinkpathDest(meal.link, "");
					if (dest instanceof TFile) void this.ctx.app.workspace.getLeaf(false).openFile(dest);
				});
			}
		}

		// --- grocery list ---
		const grocery = (await companion.groceryList?.()) ?? { path: "", items: [], exists: false };
		const gWrap = this.el.createDiv({ cls: "dash-grocery" });
		gWrap.createDiv({ cls: "dash-subhead", text: this.copy.groceryHeading });
		if (!grocery.exists) {
			gWrap.createDiv({ cls: "dash-muted", text: this.copy.noGroceryAt.replace("{path}", grocery.path) });
		} else if (grocery.items.length === 0) {
			gWrap.createDiv({ cls: "dash-muted", text: this.copy.groceryEmpty });
		} else {
			const remaining = grocery.items.filter((i) => !i.checked).length;
			gWrap.createDiv({
				cls: "dash-grocery-count",
				text: this.copy.remaining
					.replace("{remaining}", String(remaining))
					.replace("{total}", String(grocery.items.length)),
			});
			const list = gWrap.createDiv({ cls: "dash-grocery-list" });
			for (const item of grocery.items) {
				const row = list.createEl("label", { cls: "dash-grocery-row" });
				if (item.checked) row.addClass("is-checked");
				const box = row.createEl("input", { attr: { type: "checkbox" } });
				box.checked = item.checked;
				box.addEventListener("change", async () => {
					await companion.toggleGroceryItem?.(item.line);
					this.ctx.markFoodFocus();
					this.rerender();
				});
				row.createSpan({ cls: "dash-grocery-name", text: item.name });
			}
		}

		// --- actions ---
		const actions = this.el.createDiv({ cls: "dash-btn-row" });
		const nudge = () => this.ctx.markFoodFocus();
		for (const cmd of this.copy.commands) {
			commandButton(actions, this.ctx.app, cmd.id, cmd.label, {
				cls: cmd.cls,
				offlineText: this.copy.commandOffline,
				onRun: cmd.food ? nudge : undefined,
			});
		}
	}
}
