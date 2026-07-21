import { Notice, TFile, moment } from "obsidian";
import { BasePanel, placard } from "./types";
import { dailyNotePath, ensureDailyNote, getDailyNoteFile } from "../core/dailynote";

/**
 * Calendar of daily notes. A month grid where days that already have a daily
 * note are marked; tapping a day opens it (creating it from the core template
 * first if it doesn't exist yet). A header button opens the configured Logs
 * base note.
 */
export class CalendarPanel extends BasePanel {
	id = "calendar";
	title = "Calendar";
	/** The month currently shown (first-of-month moment). */
	private view = moment().startOf("month");

	protected renderBody(): void {
		const head = placard(this.el, "Calendar");
		const baseNote = (this.ctx.settings().logsBaseNote ?? "").trim();
		if (baseNote) {
			const openBase = head.createEl("button", { cls: "mrd-btn mrd-btn-sm mrd-cal-basebtn", text: "Logs base" });
			openBase.addEventListener("click", () => void this.ctx.app.workspace.openLinkText(baseNote, "", false));
		}

		// Month navigation.
		const nav = this.el.createDiv({ cls: "mrd-cal-nav" });
		this.navBtn(nav, "‹", "Previous month", () => {
			this.view = this.view.clone().subtract(1, "month");
			this.rerender();
		});
		nav.createDiv({ cls: "mrd-cal-title", text: this.view.format("MMMM YYYY") });
		this.navBtn(nav, "›", "Next month", () => {
			this.view = this.view.clone().add(1, "month");
			this.rerender();
		});
		this.navBtn(nav, "Today", "Jump to this month", () => {
			this.view = moment().startOf("month");
			this.rerender();
		});

		// Weekday header (locale-aware week start).
		const grid = this.el.createDiv({ cls: "mrd-cal-grid" });
		const weekStart = this.view.clone().startOf("month").startOf("week");
		for (let i = 0; i < 7; i++) {
			grid.createDiv({ cls: "mrd-cal-dow", text: weekStart.clone().add(i, "days").format("dd") });
		}

		// Six weeks of cells covers every month.
		const todayStr = moment().format("YYYY-MM-DD");
		const month = this.view.month();
		for (let i = 0; i < 42; i++) {
			const day = weekStart.clone().add(i, "days");
			const dateStr = day.format("YYYY-MM-DD");
			const exists = !!this.ctx.app.vault.getAbstractFileByPath(dailyNotePath(this.ctx.app, dateStr));

			const cell = grid.createDiv({ cls: "mrd-cal-cell" });
			if (day.month() !== month) cell.addClass("is-outside");
			if (dateStr === todayStr) cell.addClass("is-today");
			if (exists) cell.addClass("has-note");
			cell.createSpan({ cls: "mrd-cal-num", text: String(day.date()) });
			if (exists) cell.createSpan({ cls: "mrd-cal-dot" });

			cell.setAttr("aria-label", day.format("YYYY-MM-DD") + (exists ? " · note exists" : ""));
			cell.addEventListener("click", () => void this.openDay(dateStr, exists));
		}

		this.el.createDiv({
			cls: "mrd-cal-legend",
			text: "Filled days have a daily note. Tap any day to open it — an empty day is created from your daily-note template.",
		});
	}

	private navBtn(parent: HTMLElement, glyph: string, label: string, onClick: () => void): void {
		const b = parent.createEl("button", { cls: "mrd-cal-navbtn", text: glyph, attr: { "aria-label": label, title: label } });
		b.addEventListener("click", onClick);
	}

	private async openDay(dateStr: string, exists: boolean): Promise<void> {
		try {
			let file: TFile | null = getDailyNoteFile(this.ctx.app, dateStr);
			if (!file) file = await ensureDailyNote(this.ctx.app, dateStr);
			await this.ctx.app.workspace.getLeaf(false).openFile(file);
			if (!exists) this.rerender();
		} catch (e) {
			console.error("dash-core: could not open daily note", e);
			new Notice("Could not open that daily note.");
		}
	}
}
