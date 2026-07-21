/**
 * A tiny zero-dependency test harness. The repo has no test framework and the
 * build is only tsc + esbuild, so new pure logic is covered by node-runnable
 * tests bundled through esbuild (see test/run.mjs). Assertions throw; the runner
 * reports pass/fail counts and exits non-zero on any failure.
 */
import assert from "node:assert/strict";

interface Case {
	name: string;
	fn: () => void;
}

const cases: Case[] = [];

export function test(name: string, fn: () => void): void {
	cases.push({ name, fn });
}

export const eq = assert.deepEqual;
export const is = assert.equal;
export const ok = assert.ok;

export function report(): void {
	let passed = 0;
	const failures: string[] = [];
	for (const c of cases) {
		try {
			c.fn();
			passed++;
			console.log(`  ok  ${c.name}`);
		} catch (e) {
			failures.push(`${c.name}: ${(e as Error).message}`);
			console.log(`  FAIL ${c.name}`);
		}
	}
	console.log(`\n${passed}/${cases.length} passed`);
	if (failures.length) {
		console.error("\nFailures:");
		for (const f of failures) console.error("  - " + f);
		process.exit(1);
	}
}
