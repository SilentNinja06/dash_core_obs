import { App } from "obsidian";
import type { TodoStore } from "../core/todostore";
import type { StreakData } from "../core/streak";
import type { CompanionData } from "../core/companion";
import type { LocalEvent } from "../core/localevents";

/**
 * The generic panel contract. Core panels depend only on the capability surface
 * declared here — never on a concrete host plugin — so both dashboards can mount
 * them by supplying a `PanelContext`. The host builds one context object that
 * satisfies this interface (and may extend it with host-only members, e.g. its
 * companion-plugin readers); it passes that object to core panels typed as
 * `PanelContext` and to its own lore panels typed as the extended shape.
 *
 * This interface grows as panels are migrated: each batch adds the capabilities
 * the newly-moved panels need. Keep additions host-agnostic — a capability that
 * only one dashboard could implement does not belong here.
 */

export type RefreshReason = "open" | "interval" | "vault" | "manual";

/**
 * User-facing chrome/status copy a host injects so core panels carry no voice.
 * These are titles, empty states, and status strings — never canon lines (those
 * live only in the host's own lore panel). A host supplies the strings its
 * mounted core panels reference; each host ships its own register of copy.
 * Typed as an open string map so panels can be migrated incrementally without a
 * lockstep interface edit; each panel documents the keys it reads.
 */
export interface DashCopy {
	[key: string]: string;
}

/** A navigation destination: a note/base link, or an Obsidian command id. */
export interface PlaceLink {
	label: string;
	/** A note/base link target, or a command id when `type` is "command". */
	target: string;
	type: "note" | "command";
}

/** An ICS calendar subscription for the agenda. */
export interface CalendarLink {
	label: string;
	url: string;
	/** Whether this calendar's events count toward the next-event countdown. */
	countdown?: boolean;
	/** Optional explicit swatch colour (else a palette colour by index). */
	color?: string;
}

/** One entry in the per-calendar ICS cache. */
export interface AgendaCacheEntry {
	text: string;
	fetchedAt: number;
}

/**
 * The subset of host settings core panels read. A host's full settings object
 * structurally satisfies this (it declares a superset of fields); the host's
 * context narrows `settings()` to its own concrete type. Grows as panels that
 * read new fields migrate — keep every field host-agnostic.
 */
export interface DashSettings {
	/** Optional "base"/index note a calendar-style panel links to. */
	logsBaseNote?: string;
	/** Navigation destinations for the places panel. */
	places: PlaceLink[];
	/** Folder the knowledge-base search is scoped to (empty = whole vault). */
	kbSearchPath?: string;
	/** Multiple folders to scope the KB search to (union). Takes precedence over
	 * `kbSearchPath` when non-empty; empty = fall back to `kbSearchPath`. */
	kbSearchPaths?: string[];
	/** How many recently-modified notes to show for an empty KB query. */
	kbRecentCount?: number;
	/** Whether the KB search also scans note bodies (behind a size guard). */
	kbSearchBody?: boolean;
	/** ICS calendar subscriptions for the agenda. */
	agendaUrls: CalendarLink[];
	/** Minutes between agenda re-fetches (default 30). */
	agendaRefreshMinutes?: number;
}

/** Generic cross-panel runtime hints (not persisted). A host may carry more on
 * its own runtime; core panels see only these. */
export interface DashRuntime {
	/** ms timestamp the current view session started. */
	sessionStart: number;
	/** ms timestamp of the previous session's last access. */
	previousAccess: number;
	/** While `Date.now() < typingUntil`, the user is typing in a free-text field;
	 * the vault-refresh bus is deferred so the layout doesn't jump. */
	typingUntil: number;
}

/**
 * The capability surface core panels depend on. Implemented by the host.
 * (Service accessors for libraries, local events, weekly goals, the agenda
 * cache, and persistence are added here as the panels that use them migrate.)
 */
export interface PanelContext {
	app: App;
	todos: TodoStore;
	/** Current observation-streak snapshot. */
	streak: StreakData;
	/** Optional companion-plugin data; a host without a companion omits its
	 * methods and consuming panels simply render fewer rows. */
	companion: CompanionData;
	runtime: DashRuntime;
	/** Host-injected chrome/status copy (see `DashCopy`). */
	copy: DashCopy;
	/** The host's settings, seen through the generic `DashSettings` view. */
	settings(): DashSettings;
	/** Per-calendar ICS cache (raw text + fetch time), keyed by url. Read by the
	 * agenda; the agenda writes fresh reads back and then calls `persist()`. */
	agendaCache: Record<string, AgendaCacheEntry>;
	/** The host's local (dashboard-only) events. */
	localEvents: LocalEvent[];
	/** Persist host data (e.g. after refreshing the agenda cache). */
	persist(): Promise<void>;
	/** Re-render all mounted panels. */
	requestRefresh(reason?: RefreshReason): void;
	/** Signal that the user interacted with a food/nourishment surface. A generic
	 * hook: hosts with no food concept implement it as a no-op. */
	markFoodFocus(): void;
}

/** A dashboard panel module. */
export interface Panel {
	id: string;
	title: string;
	mount(el: HTMLElement, ctx: PanelContext): void | Promise<void>;
	refresh?(reason?: RefreshReason): void | Promise<void>;
	unmount?(): void;
}

/**
 * Base class handling the mount/draw/refresh/cleanup lifecycle. Long-lived
 * timers and subscriptions go in `setup()` (run once on mount); `renderBody()`
 * draws into a cleared element and may run on every refresh.
 *
 * Generic over the context type so a host's lore panels can extend `BasePanel`
 * with their richer context while core panels use the plain `PanelContext`.
 */
export abstract class BasePanel<C extends PanelContext = PanelContext> implements Panel {
	abstract id: string;
	abstract title: string;
	protected el!: HTMLElement;
	protected ctx!: C;
	private cleanups: Array<() => void> = [];

	async mount(el: HTMLElement, ctx: PanelContext): Promise<void> {
		this.el = el;
		this.ctx = ctx as C;
		await this.setup();
		await this.draw();
	}

	async refresh(reason?: RefreshReason): Promise<void> {
		if (this.el?.isConnected) await this.draw(reason);
	}

	unmount(): void {
		for (const c of this.cleanups) {
			try {
				c();
			} catch {
				/* ignore */
			}
		}
		this.cleanups = [];
	}

	protected onCleanup(fn: () => void): void {
		this.cleanups.push(fn);
	}

	/** One-time setup (intervals, event subscriptions). Optional. */
	protected async setup(): Promise<void> {
		/* override as needed */
	}

	/** Re-run the body render from within the panel (after a local change). */
	protected rerender(): void {
		void this.draw("manual");
	}

	private async draw(reason?: RefreshReason): Promise<void> {
		this.el.empty();
		await this.renderBody(reason);
	}

	protected abstract renderBody(reason?: RefreshReason): void | Promise<void>;

	protected setInterval(fn: () => void, ms: number): void {
		const id = window.setInterval(fn, ms);
		this.onCleanup(() => window.clearInterval(id));
	}
}

// ------------------------------------------------------- small DOM helpers

/** A stenciled panel placard header. Returns the placard element so panels can
 * append status chips on the right. */
export function placard(el: HTMLElement, title: string): HTMLElement {
	const head = el.createDiv({ cls: "dash-placard" });
	head.createSpan({ cls: "dash-placard-title", text: title.toUpperCase() });
	return head;
}
