import { App, Modal, Setting } from "obsidian";

/**
 * A minimal single-field prompt modal, used by the log commands (§1.1) so a
 * dashboard leaf need not be open to jot into today's note. Functional UI
 * chrome — carries no host voice.
 */
export class PromptModal extends Modal {
	private value: string;

	constructor(
		app: App,
		private opts: { title: string; placeholder?: string; cta?: string; initial?: string; multiline?: boolean },
		private onSubmit: (text: string) => void
	) {
		super(app);
		this.value = opts.initial ?? "";
	}

	onOpen(): void {
		this.titleEl.setText(this.opts.title);
		const setting = new Setting(this.contentEl);
		if (this.opts.multiline) {
			setting.addTextArea((t) => {
				t.setPlaceholder(this.opts.placeholder ?? "").setValue(this.value).onChange((v) => (this.value = v));
				t.inputEl.classList.add("dash-modal-wide");
				t.inputEl.rows = 4;
				t.inputEl.focus();
			});
		} else {
			setting.addText((t) => {
				t.setPlaceholder(this.opts.placeholder ?? "").setValue(this.value).onChange((v) => (this.value = v));
				t.inputEl.classList.add("dash-modal-wide");
				t.inputEl.focus();
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.submit();
					}
				});
			});
		}

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText(this.opts.cta ?? "Save").setCta().onClick(() => this.submit()));
	}

	private submit(): void {
		const text = this.value.trim();
		this.close();
		if (text) this.onSubmit(text);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
