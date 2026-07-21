import { App, Modal } from "obsidian";

/**
 * Weekly review — a generic renderer for a read-only 7-day rollup. Core holds no
 * voice and no host-specific stats: the host compiles a `WeekReviewData` (header,
 * an optional streak line, and a list of stat blocks, every string already
 * written in its own register) and this modal draws it. Each block may carry a
 * headline figure with per-day bars, a stat line, and/or a chip list.
 */

/** One per-day bar. */
export interface WeekReviewBar {
	/** Short axis label (e.g. a weekday initial). */
	label: string;
	count: number;
}

/** One stat block. Fields present are rendered in order: figure, bars, line, chips. */
export interface WeekReviewBlock {
	head: string;
	figure?: string;
	bars?: WeekReviewBar[];
	line?: string;
	chips?: string[];
}

/** The compiled rollup the host hands to the renderer. */
export interface WeekReviewData {
	header: string;
	/** Optional single streak/record line, already formatted by the host. */
	streakLine?: string;
	blocks: WeekReviewBlock[];
}

/** Host config: the modal title, the "compiling…" placeholder, and the async
 * compile that reads the host's own notes/markers and returns the data. */
export interface WeekReviewConfig {
	title: string;
	compilingText: string;
	compile: () => Promise<WeekReviewData>;
}

export class WeekReviewModal extends Modal {
	constructor(app: App, private config: WeekReviewConfig) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.config.title);
		this.modalEl.addClass("mrd-review-modal");
		const body = this.contentEl.createDiv({ cls: "mrd-review" });
		body.createDiv({ cls: "mrd-muted", text: this.config.compilingText });
		void this.config.compile().then((data) => {
			if (!body.isConnected) return;
			this.render(body, data);
		});
	}

	private render(host: HTMLElement, data: WeekReviewData): void {
		host.empty();
		host.createDiv({ cls: "mrd-review-header", text: data.header });
		if (data.streakLine) host.createDiv({ cls: "mrd-review-streak", text: data.streakLine });

		for (const block of data.blocks) {
			const b = host.createDiv({ cls: "mrd-review-block" });
			b.createDiv({ cls: "mrd-review-stat-head", text: block.head });
			if (block.figure !== undefined) b.createDiv({ cls: "mrd-review-figure", text: block.figure });
			if (block.bars) this.renderBars(b, block.bars);
			if (block.line !== undefined) b.createDiv({ cls: "mrd-review-line", text: block.line });
			if (block.chips) {
				const chips = b.createDiv({ cls: "mrd-review-chips" });
				for (const name of block.chips) chips.createSpan({ cls: "mrd-chip mrd-chip-cold", text: name });
			}
		}
	}

	private renderBars(parent: HTMLElement, data: WeekReviewBar[]): void {
		const bars = parent.createDiv({ cls: "mrd-review-bars" });
		const max = Math.max(1, ...data.map((d) => d.count));
		for (const d of data) {
			const cell = bars.createDiv({ cls: "mrd-review-bar-cell" });
			const track = cell.createDiv({ cls: "mrd-review-bar-track" });
			const fill = track.createDiv({ cls: "mrd-review-bar-fill" });
			fill.style.height = `${Math.round((d.count / max) * 100)}%`;
			if (d.count === 0) fill.addClass("is-empty");
			cell.createDiv({ cls: "mrd-review-bar-day", text: d.label });
			cell.createDiv({ cls: "mrd-review-bar-count", text: String(d.count) });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
