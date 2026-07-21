/**
 * dash_core_obs — the shared, lore-free machinery behind the MERIDIAN and
 * friendly Obsidian dashboards. This is a build-time library: consumers bundle
 * it into their own `main.js` via esbuild (it externalizes `obsidian` the same
 * as they do), so there is no runtime dependency and no install-order problem.
 *
 * Everything here is host-plugin-agnostic: it may use genuine Obsidian host
 * APIs (`App`, `TFile`, `requestUrl`, `moment`, …) that exist identically in
 * every Obsidian runtime, but it names no dashboard's lore — no host branding,
 * no companion-plugin ids, no canon lines. Host-specific copy, seed
 * content, palettes, and the directives header are all injected by the host.
 */

// Agenda / ICS / next-event math
export * from "./core/ics";
export * from "./core/agendamath";
export * from "./core/localevents";

// Directives engine + persistence
export * from "./core/todostore";
export * from "./core/subitems";
export * from "./core/directivesserde";
export * from "./core/directivesstore";

// Daily-note contract (the generic "note source") + note libraries
export * from "./core/dailynote";
export * from "./core/library";

// Observation streak
export * from "./core/streak";

// Companion-data capability interface (implemented by each host)
export * from "./core/companion";

// Panel contract (generic PanelContext / BasePanel / DashCopy) + pure layout model
export * from "./panels/types";
export * from "./panels/layout";

// Generic, host-agnostic panels
export * from "./panels/promptmodal";
export * from "./panels/calendar";
export * from "./panels/todomodal";
export * from "./panels/categorymodals";
export * from "./panels/clock";
export * from "./panels/util";
export * from "./panels/places";
export * from "./panels/localeventmodal";
export * from "./panels/meals";
export * from "./panels/journal";
export * from "./panels/weeklygoals";
export * from "./panels/secondbrain";
export * from "./panels/search";
export * from "./panels/todo";
export * from "./panels/weekreview";
