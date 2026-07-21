import { moment } from "obsidian";
import { BasePanel, RefreshReason, placard } from "./types";
import { FieldSpec, headingField, readDailyField, readDailyNoteRaw, readField, writeDailyField } from "../core/dailynote";

/**
 * Journal / free-text panel. A set of editable fields, each an editor for a
 * section of today's note, plus an optional read-only carry-over of a field from
 * *yesterday* onto today. Debounced autosave (~800ms); textareas that grow. These
 * are editors *for the note*, not a separate store; on an external refresh values
 * reload unless the user is mid-edit.
 *
 * The specific field set (which note sections, their labels) and the carry-over
 * are host config injected via `JournalCopy` — core names no dashboard's fields.
 */

/** One editable field: a label and the note-section spec it edits. */
export interface JournalField {
	label: string;
	spec: FieldSpec;
	/** Strip empty `- [ ]` / bullet placeholders when loading the field. */
	stripPlaceholder?: boolean;
	/** Optional textarea placeholder shown while the field is empty. */
	placeholder?: string;
}

/** Host-injected config/copy for the journal panel. */
export interface JournalCopy {
	title: string;
	/** The note heading to carry from yesterday onto today (omit to skip). */
	carryHeading?: string;
	/** Label above the carried-over block. */
	carryLabel?: string;
	fields: JournalField[];
}

export class JournalPanel extends BasePanel {
	id = "journal";
	title: string;
	private editing = false;

	constructor(private copy: JournalCopy) {
		super();
		this.title = copy.title;
	}

	async refresh(reason?: RefreshReason): Promise<void> {
		// Don't yank the text out from under the user mid-sentence.
		if (reason === "vault" && this.editing) return;
		if (this.el?.isConnected) {
			this.el.empty();
			await this.renderBody();
		}
	}

	protected async renderBody(): Promise<void> {
		placard(this.el, this.copy.title);
		await this.renderYesterdayCarry();
		const wrap = this.el.createDiv({ cls: "dash-journal" });
		for (const field of this.copy.fields) {
			await this.renderField(wrap, field);
		}
	}

	/** Read-only carry-over of yesterday's configured heading onto today. */
	private async renderYesterdayCarry(): Promise<void> {
		if (!this.copy.carryHeading) return;
		const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
		let text = "";
		try {
			const raw = await readDailyNoteRaw(this.ctx.app, yesterday);
			text = tidy(readField(raw, headingField(this.copy.carryHeading)));
		} catch (e) {
			console.error("dash-core: could not read yesterday's carry-over", e);
		}
		if (!text) return; // nothing worth carrying — stay quiet
		const block = this.el.createDiv({ cls: "dash-carry" });
		if (this.copy.carryLabel) block.createDiv({ cls: "dash-carry-label", text: this.copy.carryLabel });
		block.createDiv({ cls: "dash-carry-body", text });
	}

	private async renderField(parent: HTMLElement, field: JournalField): Promise<void> {
		const block = parent.createDiv({ cls: "dash-journal-field" });
		block.createDiv({ cls: "dash-journal-label", text: field.label });
		const ta = block.createEl("textarea", {
			cls: "dash-journal-input",
			attr: field.placeholder ? { placeholder: field.placeholder } : {},
		});
		const loaded = await readDailyField(this.ctx.app, field.spec);
		ta.value = field.stripPlaceholder ? tidy(loaded) : loaded;
		autosize(ta);

		let timer: number | null = null;
		const save = () => {
			void writeDailyField(this.ctx.app, field.spec, ta.value).catch((e) =>
				console.error("dash-core: journal save failed", e)
			);
		};
		ta.addEventListener("focus", () => {
			this.editing = true;
			this.ctx.runtime.typingUntil = Date.now() + 2000;
		});
		ta.addEventListener("blur", () => {
			this.editing = false;
			this.ctx.runtime.typingUntil = 0;
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
			save();
		});
		ta.addEventListener("input", () => {
			// Hold off the vault-refresh bus while actively typing so the layout
			// doesn't jump; the window is renewed on each keystroke.
			this.ctx.runtime.typingUntil = Date.now() + 2000;
			autosize(ta);
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = null;
				save();
			}, 800);
		});
		this.onCleanup(() => {
			if (timer !== null) window.clearTimeout(timer);
		});
	}
}

function autosize(ta: HTMLTextAreaElement): void {
	ta.style.height = "auto";
	ta.style.height = Math.max(48, ta.scrollHeight) + "px";
}

/** Drop empty bullet/checkbox placeholders so an untouched section reads as
 * empty rather than carrying a lone "- [ ]". */
function tidy(text: string): string {
	return text
		.split("\n")
		.map((l) => l.replace(/\s+$/, ""))
		.filter((l) => l.trim() !== "" && !/^\s*-\s*(\[[ xX]?\]\s*)?$/.test(l))
		.join("\n")
		.trim();
}
