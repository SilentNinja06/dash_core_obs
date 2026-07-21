import { moment } from "obsidian";
import { BasePanel, placard } from "./types";
import { AgendaItem, eventsOnDate, fetchICS, parseICS } from "../core/ics";
import { agendaState, formatGap } from "../core/agendamath";
import { LocalEvent, localEventToAgendaItem } from "../core/localevents";

/**
 * Today's agenda. Today only — no month view. Fetches each ICS share link via
 * requestUrl (CORS-free, mobile + desktop), caches the last successful fetch in
 * host data so it renders offline, and surfaces fetch failures *visibly*. All
 * copy, the calendar colours, and the modal actions are host-injected; the cache,
 * local events, and persistence come through the panel context.
 */

/** Host-injected copy. Templates: `fetchFailed` uses `{label}`/`{error}`;
 * `staleness` uses `{when}`; `endsIn`/`inT`/`gapOpen`/`gapUntil` use `{t}`. */
export interface AgendaCopy {
	title: string;
	addEvent: string;
	weeklyGoals: string;
	printWeek: string;
	noCalendars: string;
	localLabel: string;
	fetchFailed: string;
	allDay: string;
	editLocal: string;
	staleness: string;
	clearRest: string;
	clearDay: string;
	now: string;
	next: string;
	endsIn: string;
	inT: string;
	gapClear: string;
	gapOpen: string;
	gapUntil: string;
}

/** Host actions the agenda triggers (each opens a modal with host deps). */
export interface AgendaActions {
	openLocalEvent: (existing: LocalEvent | undefined, onDone: () => void) => void;
	openWeeklyGoals: (onDone: () => void) => void;
	openWeekPrint: () => void;
}

export class AgendaPanel extends BasePanel {
	id = "agenda";
	title: string;
	private errors = new Map<string, string>();
	private fetching = false;
	private dayItems: AgendaItem[] = [];
	private hadEvents = false;
	private countdownEl?: HTMLElement;

	constructor(
		private copy: AgendaCopy,
		private calendarColor: (index: number) => string,
		private localEventColor: string,
		private actions: AgendaActions
	) {
		super();
		this.title = copy.title;
	}

	protected async setup(): Promise<void> {
		const minutes = Math.max(1, this.ctx.settings().agendaRefreshMinutes || 30);
		this.setInterval(() => void this.fetchAll(), minutes * 60 * 1000);
		this.setInterval(() => this.tickCountdown(), 60 * 1000);
		void this.fetchAll();
	}

	protected renderBody(): void {
		const s = this.ctx.settings();
		const head = placard(this.el, this.copy.title);
		head.createSpan({ cls: "dash-placard-badge", text: moment().format("YYYY-MM-DD") });
		const actions = this.el.createDiv({ cls: "dash-btn-row dash-agenda-actions" });
		const addBtn = actions.createEl("button", { cls: "dash-btn dash-btn-sm", text: this.copy.addEvent });
		addBtn.addEventListener("click", () => this.actions.openLocalEvent(undefined, () => this.rerender()));
		const goalsBtn = actions.createEl("button", { cls: "dash-btn dash-btn-sm", text: this.copy.weeklyGoals });
		goalsBtn.addEventListener("click", () => this.actions.openWeeklyGoals(() => this.rerender()));
		const printBtn = actions.createEl("button", { cls: "dash-btn dash-btn-sm", text: this.copy.printWeek });
		printBtn.addEventListener("click", () => {
			// Best-effort freshen, then open the planner from cache.
			void this.fetchAll();
			this.actions.openWeekPrint();
		});

		const today = moment().format("YYYY-MM-DD");
		const localToday = this.ctx.localEvents.filter((e) => e.date === today);

		if (s.agendaUrls.length === 0 && localToday.length === 0) {
			this.el.createDiv({ cls: "dash-muted", text: this.copy.noCalendars });
			return;
		}

		const rows: Array<{ item: AgendaItem; color: string; label: string; countdown: boolean; local?: LocalEvent }> = [];
		let anyCache = false;
		let oldest = Infinity;

		s.agendaUrls.forEach((cal, i) => {
			const color = cal.color || this.calendarColor(i);
			const countdown = cal.countdown !== false;
			const cache = this.ctx.agendaCache[cal.url];
			if (cache) {
				anyCache = true;
				oldest = Math.min(oldest, cache.fetchedAt);
				try {
					for (const item of eventsOnDate(parseICS(cache.text), today)) {
						rows.push({ item, color, label: cal.label, countdown });
					}
				} catch {
					this.errors.set(cal.url, "parse error");
				}
			}
		});

		// Local events feed the same sorted list + countdown math.
		for (const ev of localToday) {
			rows.push({ item: localEventToAgendaItem(ev), color: this.localEventColor, label: this.copy.localLabel, countdown: true, local: ev });
		}

		// Failure notices — always visible.
		const failed = s.agendaUrls.filter((c) => this.errors.has(c.url));
		if (failed.length) {
			const box = this.el.createDiv({ cls: "dash-agenda-alert" });
			for (const c of failed) {
				box.createDiv({
					cls: "dash-agenda-alert-line",
					text: this.copy.fetchFailed.replace("{label}", c.label).replace("{error}", this.errors.get(c.url) ?? ""),
				});
			}
		}

		rows.sort((a, b) => a.item.sortKey - b.item.sortKey || a.item.summary.localeCompare(b.item.summary));

		this.dayItems = rows.filter((r) => r.countdown).map((r) => r.item);
		this.hadEvents = rows.length > 0;
		this.countdownEl = this.el.createDiv({ cls: "dash-agenda-next" });
		this.renderCountdown();

		const list = this.el.createDiv({ cls: "dash-agenda-list" });
		for (const r of rows) {
			const row = list.createDiv({ cls: "dash-agenda-row" });
			row.createSpan({ cls: "dash-agenda-swatch" }).style.background = r.color;
			const time = row.createSpan({ cls: "dash-agenda-time" });
			time.setText(r.item.allDay ? this.copy.allDay : r.item.timeLabel);
			const body = row.createDiv({ cls: "dash-agenda-body" });
			const title = body.createDiv({ cls: "dash-agenda-title" });
			title.createSpan({ text: r.item.summary });
			if (r.local) title.createSpan({ cls: "dash-chip dash-chip-cold dash-agenda-local-chip", text: this.copy.localLabel });
			const sub = [r.local ? "" : r.label, r.item.location].filter(Boolean).join(" · ");
			if (sub) body.createDiv({ cls: "dash-agenda-sub", text: sub });
			if (r.local) {
				const ev = r.local;
				row.addClass("dash-agenda-row-edit");
				row.setAttr("title", this.copy.editLocal);
				row.addEventListener("click", () => this.actions.openLocalEvent(ev, () => this.rerender()));
			}
		}

		// Staleness footer.
		if (anyCache && oldest !== Infinity) {
			const age = Date.now() - oldest;
			if (age > 90 * 1000) {
				this.el.createDiv({
					cls: "dash-agenda-age",
					text: this.copy.staleness.replace("{when}", moment(oldest).fromNow()),
				});
			}
		}
	}

	/** Draw the NEXT / NOW / clear placard from the cached day items. */
	private renderCountdown(): void {
		const el = this.countdownEl;
		if (!el) return;
		el.empty();
		const state = agendaState(this.dayItems, Date.now());

		if (state.kind === "clear") {
			el.addClass("is-clear");
			el.removeClass("is-now");
			el.createDiv({
				cls: "dash-agenda-next-line",
				text: this.hadEvents ? this.copy.clearRest : this.copy.clearDay,
			});
			return;
		}

		el.removeClass("is-clear");
		el.toggleClass("is-now", state.kind === "now");
		const label = state.kind === "now" ? this.copy.now : this.copy.next;
		const line = el.createDiv({ cls: "dash-agenda-next-line" });
		line.createSpan({ cls: "dash-agenda-next-label", text: label });
		line.createSpan({ cls: "dash-agenda-next-summary", text: state.summary ?? "" });
		const until = formatGap(state.untilMs ?? 0);
		line.createSpan({
			cls: "dash-agenda-next-when",
			text: state.kind === "now" ? this.copy.endsIn.replace("{t}", until) : this.copy.inT.replace("{t}", until),
		});

		if (state.kind === "now") {
			el.createDiv({
				cls: "dash-agenda-gap",
				text: state.gapMs === undefined ? this.copy.gapClear : this.copy.gapOpen.replace("{t}", formatGap(state.gapMs)),
			});
		} else {
			el.createDiv({ cls: "dash-agenda-gap", text: this.copy.gapUntil.replace("{t}", until) });
		}
	}

	/** 1-minute tick: recompute the placard only, guarding against unmount. */
	private tickCountdown(): void {
		if (!this.el?.isConnected || !this.countdownEl?.isConnected) return;
		this.renderCountdown();
	}

	private async fetchAll(): Promise<void> {
		if (this.fetching) return;
		const urls = this.ctx.settings().agendaUrls;
		if (urls.length === 0) return;
		this.fetching = true;
		let changed = false;
		try {
			for (const cal of urls) {
				if (!cal.url) continue; // a blank row in the editor — nothing to fetch
				try {
					const text = await fetchICS(cal.url);
					this.ctx.agendaCache[cal.url] = { text, fetchedAt: Date.now() };
					this.errors.delete(cal.url);
					changed = true;
				} catch (e) {
					this.errors.set(cal.url, String((e as Error)?.message ?? e));
				}
			}
			if (changed) await this.ctx.persist();
		} finally {
			this.fetching = false;
		}
		if (this.el?.isConnected) this.rerender();
	}
}
