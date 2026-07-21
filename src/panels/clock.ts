import { moment } from "obsidian";
import { BasePanel, placard } from "./types";

/**
 * Clock: four-digit 24h with no separator (1432), large mono, beside the time
 * since last access. The structure is generic; every user-facing string — the
 * title and the whole "since last access" register — is host-injected via
 * `ClockCopy`, so core holds no voice. The streak record reads from the generic
 * `ctx.streak`.
 */

/** Host-injected copy for the clock. Templates use `{dur}` for the humanized
 * gap and `{count}`/`{unit}` for the streak record. */
export interface ClockCopy {
	/** Panel title / placard, e.g. "Chronometer". */
	title: string;
	/** No prior access on record. */
	firstAccess: string;
	/** Gap under ~45s. */
	continuous: string;
	/** Gap under 1h; `{dur}` = humanized gap. */
	under1h: string;
	/** Gap under 6h. */
	under6h: string;
	/** Gap under 24h. */
	under24h: string;
	/** Gap of 24h or more. */
	longer: string;
	/** Streak record line; `{count}` and `{unit}`. */
	record: string;
	/** Singular / plural unit for the record line. */
	dayUnit: string;
	daysUnit: string;
}

export class ClockPanel extends BasePanel {
	id = "clock";
	title: string;
	private digitsEl?: HTMLElement;
	private secEl?: HTMLElement;
	private sinceEl?: HTMLElement;
	private dateEl?: HTMLElement;
	private previousAccess = 0;

	constructor(private copy: ClockCopy) {
		super();
		this.title = copy.title;
	}

	protected async setup(): Promise<void> {
		this.previousAccess = this.ctx.runtime.previousAccess;
		this.setInterval(() => this.tick(), 1000);
	}

	protected renderBody(): void {
		placard(this.el, this.copy.title);
		const wrap = this.el.createDiv({ cls: "mrd-clock" });
		const main = wrap.createDiv({ cls: "mrd-clock-main" });
		this.digitsEl = main.createSpan({ cls: "mrd-clock-digits" });
		this.secEl = main.createSpan({ cls: "mrd-clock-sec" });
		this.dateEl = wrap.createDiv({ cls: "mrd-clock-date" });
		this.sinceEl = wrap.createDiv({ cls: "mrd-clock-since" });
		// Streak record — read-only, positive framing only; silent at zero.
		const streak = this.ctx.streak;
		if (streak.current > 0) {
			wrap.createDiv({
				cls: "mrd-clock-record",
				text: this.copy.record
					.replace("{count}", String(streak.current))
					.replace("{unit}", streak.current === 1 ? this.copy.dayUnit : this.copy.daysUnit),
			});
		}
		this.tick();
	}

	private tick(): void {
		const now = moment();
		if (this.digitsEl) this.digitsEl.setText(now.format("HHmm"));
		if (this.secEl) this.secEl.setText(now.format("ss"));
		if (this.dateEl) this.dateEl.setText(now.format("dddd · YYYY-MM-DD").toUpperCase());
		if (this.sinceEl) this.sinceEl.setText(this.sinceLine());
	}

	private sinceLine(): string {
		const prev = this.previousAccess;
		if (!prev) return this.copy.firstAccess;
		const secs = Math.max(0, Math.floor((Date.now() - prev) / 1000));
		if (secs < 45) return this.copy.continuous;
		const dur = humanize(secs);
		if (secs < 3600) return this.copy.under1h.replace("{dur}", dur);
		if (secs < 6 * 3600) return this.copy.under6h.replace("{dur}", dur);
		if (secs < 24 * 3600) return this.copy.under24h.replace("{dur}", dur);
		return this.copy.longer.replace("{dur}", dur);
	}
}

function humanize(totalSecs: number): string {
	const d = Math.floor(totalSecs / 86400);
	const h = Math.floor((totalSecs % 86400) / 3600);
	const m = Math.floor((totalSecs % 3600) / 60);
	const parts: string[] = [];
	if (d) parts.push(`${d}d`);
	if (h) parts.push(`${h}h`);
	if (m || (!d && !h)) parts.push(`${m}m`);
	return parts.slice(0, 2).join(" ");
}
