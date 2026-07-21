/**
 * Desktop grid layout model (§3.1). Pure so the placement/guard logic is testable.
 *
 * When the user hasn't assigned any columns/spans the layout is "unconfigured"
 * and the view keeps its existing multi-column masonry (nothing changes). Once a
 * panel is put in column 2+ or given a span, the view switches to an explicit CSS
 * grid above the mobile breakpoint; below it, panels always collapse to a single
 * column in `panelOrder` sequence.
 *
 * Guards: a column beyond the computed width falls back to column 1, and a span
 * is clamped inside the grid — never a blank grid.
 */
export const MAX_COLUMNS = 3;

export interface PanelPlacement {
	id: string;
	column: number;
	span: number;
}

export interface GridLayout {
	configured: boolean;
	columns: number;
	placements: PanelPlacement[];
}

function clampInt(v: number, lo: number, hi: number): number {
	const n = Math.floor(Number.isFinite(v) ? v : lo);
	return Math.max(lo, Math.min(hi, n));
}

export function computeLayout(
	order: string[],
	enabled: Record<string, boolean>,
	columns: Record<string, number>,
	spans: Record<string, number>
): GridLayout {
	const ids = order.filter((id) => enabled[id] !== false);
	const raw = ids.map((id) => ({
		id,
		col: clampInt(columns[id] ?? 1, 1, MAX_COLUMNS),
		span: clampInt(spans[id] ?? 1, 1, MAX_COLUMNS),
	}));

	const configured = raw.some((p) => p.col > 1 || p.span > 1);
	if (!configured) {
		return { configured: false, columns: 1, placements: ids.map((id) => ({ id, column: 1, span: 1 })) };
	}

	let N = 1;
	for (const p of raw) N = Math.max(N, p.col + p.span - 1);
	N = Math.min(MAX_COLUMNS, Math.max(1, N));

	const placements = raw.map((p) => {
		const column = p.col > N ? 1 : p.col; // orphaned column → fall to 1
		const span = Math.max(1, Math.min(p.span, N - column + 1)); // clamp inside the grid
		return { id: p.id, column, span };
	});
	return { configured: true, columns: N, placements };
}
