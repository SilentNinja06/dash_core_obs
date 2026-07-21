import { App } from "obsidian";

/** Whether an Obsidian command id is currently registered (its plugin enabled). */
export function commandExists(app: App, fullId: string): boolean {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const commands = (app as any).commands?.commands ?? {};
	return !!commands[fullId];
}

/** Run an Obsidian command by id (no-op if it isn't registered). */
export function runCommand(app: App, fullId: string): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(app as any).commands?.executeCommandById?.(fullId);
}

/**
 * A button wired to an Obsidian command. If the command is missing (its plugin
 * disabled), the button is disabled with the host-supplied `offlineText` tooltip
 * — never a crash. Core holds no voice: the disabled message is injected.
 */
export function commandButton(
	parent: HTMLElement,
	app: App,
	fullId: string,
	label: string,
	opts: { cls?: string; onRun?: () => void; offlineText?: string } = {}
): HTMLButtonElement {
	const btn = parent.createEl("button", { cls: `mrd-btn ${opts.cls ?? ""}`.trim(), text: label });
	if (!commandExists(app, fullId)) {
		btn.setAttr("disabled", "true");
		btn.addClass("is-unavailable");
		if (opts.offlineText) btn.setAttr("title", opts.offlineText);
		return btn;
	}
	btn.addEventListener("click", () => {
		runCommand(app, fullId);
		opts.onRun?.();
	});
	return btn;
}
