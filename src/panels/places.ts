import { BasePanel, placard } from "./types";
import { commandButton } from "./util";

/**
 * Places / navigation. A user-editable list of destinations: notes and core
 * Bases (`.base`) opened exactly the way a link click does, plus command targets
 * (companion-plugin dashboards). Edit the list in settings.
 *
 * The panel title, empty-state, and the disabled-command tooltip are host copy
 * (`PlacesCopy`); everything else is neutral.
 */

/** Host-injected copy for the places panel. */
export interface PlacesCopy {
	/** Panel title / placard, e.g. "Navigation". */
	title: string;
	/** Shown when no destinations are configured. */
	empty: string;
	/** Tooltip on a command button whose plugin is offline. */
	commandOffline: string;
}

export class PlacesPanel extends BasePanel {
	id = "places";
	title: string;

	constructor(private copy: PlacesCopy) {
		super();
		this.title = copy.title;
	}

	protected renderBody(): void {
		placard(this.el, this.copy.title);
		const grid = this.el.createDiv({ cls: "mrd-places" });
		const places = this.ctx.settings().places;
		if (places.length === 0) {
			grid.createDiv({ cls: "mrd-muted", text: this.copy.empty });
			return;
		}
		for (const place of places) {
			if (place.type === "command") {
				commandButton(grid, this.ctx.app, place.target, place.label, {
					cls: "mrd-place-btn",
					offlineText: this.copy.commandOffline,
				});
			} else {
				const btn = grid.createEl("button", { cls: "mrd-btn mrd-place-btn", text: place.label });
				btn.addEventListener("click", () => {
					// Open notes and .base files the way a link click does.
					void this.ctx.app.workspace.openLinkText(place.target, "", false);
				});
			}
		}
	}
}
