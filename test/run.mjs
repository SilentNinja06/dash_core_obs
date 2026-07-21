// Bundle the test entry through esbuild (aliasing "obsidian" to a stub so any
// transitive import resolves) and run it with node. Keeps tests dependency-free.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "mrd-test-"));
const stub = join(dir, "obsidian-stub.js");
writeFileSync(stub, "export const moment = () => { throw new Error('obsidian stub'); };\n");
const out = join(dir, "tests.mjs");

await build({
	entryPoints: ["test/index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: out,
	alias: { obsidian: stub },
	logLevel: "warning",
});

await import(pathToFileURL(out).href);
