import { tryParseJson } from "./directivesserde";

/**
 * Pure (Obsidian-free) serialization for the AI credentials file.
 *
 * The API key used to live only in the plugin's `data.json`, which syncs across
 * devices ONLY with "installed community plugins" enabled — and even then this
 * vault has proven it unreliable (the same reason directives, local events, and
 * quotes were all moved to Markdown). Obsidian Sync ALWAYS syncs Markdown, so
 * the key rides in a fenced `json` block inside a `.md` file, exactly like the
 * directives, and reaches every device without depending on plugin-data sync.
 *
 * The file holds a secret, so its default location is meant to be git-ignored by
 * the vault repo (see the go-live docs / .gitignore) — that also makes it *more*
 * private than the git-tracked `data.json` it replaces.
 */
export interface AICredentials {
	/** Provider API key (Anthropic or OpenAI-compatible). */
	apiKey: string;
	/** Base URL for the OpenAI-compatible provider (ignored for Anthropic). Paired
	 * with the key so a device that only learns the key via sync also learns the
	 * endpoint it belongs to. */
	baseUrl?: string;
}

interface AICredentialsFile {
	version: number;
	apiKey: string;
	baseUrl?: string;
}

/** Neutral default header. Parsing ignores it (only the fenced ```json block is
 * read), so a host can pass its own voiced header without affecting parsing. */
export const DEFAULT_AI_CREDS_HEADER =
	"%% Dashboard — AI credentials (synced secret). Managed automatically; edit the " +
	"key in the dashboard settings, not here. Keep this file out of version control. %%";

/** JSON payload wrapped in a fenced block inside a Markdown file. Single object,
 * so there is no multi-line array a sync merge could shred (cf. directives). */
export function buildAICredsMarkdown(creds: AICredentials, header: string = DEFAULT_AI_CREDS_HEADER): string {
	const file: AICredentialsFile = { version: 1, apiKey: creds.apiKey ?? "" };
	if (creds.baseUrl) file.baseUrl = creds.baseUrl;
	return `${header}\n\n\`\`\`json\n${JSON.stringify(file)}\n\`\`\`\n`;
}

/** Extract the credentials, distinguishing a genuine parse from a failure — the
 * same contract as `tryParseTodos`. `ok` is false when the JSON is unreadable or
 * the shape is wrong; callers MUST treat that as "could not read" and never
 * persist over the file, so a sync-conflicted / half-written file is preserved. */
export function tryParseAICreds(raw: string): { ok: boolean; creds: AICredentials } {
	const r = tryParseJson(raw);
	const v = r?.value as AICredentialsFile | undefined;
	if (r && v && typeof v.apiKey === "string") {
		return { ok: true, creds: { apiKey: v.apiKey, baseUrl: typeof v.baseUrl === "string" ? v.baseUrl : undefined } };
	}
	return { ok: false, creds: { apiKey: "" } };
}
