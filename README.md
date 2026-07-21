# dash_core_obs

Shared, **lore-free** machinery behind the [MERIDIAN](https://github.com/SilentNinja06/meridian_dash_obs)
and [friendly](https://github.com/SilentNinja06/friendly_dash_obs) Obsidian dashboards.

This is a **build-time library, not a plugin** — no `manifest.json`, no `main.js`,
no release assets. Each dashboard depends on it via GitHub and esbuild bundles it
into that plugin's `main.js`. There is no runtime dependency, no install-order
problem, and no version skew: each consumer pins a commit/tag and ships a
self-contained bundle.

## What belongs here

The test of whether a module belongs in core: *would a second, differently-voiced
dashboard want it verbatim?* Core may use genuine Obsidian host APIs (`App`,
`TFile`, `requestUrl`, `moment`, …) — those exist identically in every Obsidian
runtime — but it names **no** dashboard's lore. Host-specific copy, seed content,
palettes, companion-plugin readers, and the directives file header are all
injected by the host.

## Contents

| Area | Modules |
| --- | --- |
| Agenda / ICS / next-event math | `ics`, `agendamath`, `localevents` |
| Directives engine + persistence | `todostore`, `subitems`, `directivesserde`, `directivesstore` |
| Daily-note contract ("note source") + note libraries | `dailynote`, `library` |
| Observation streak | `streak` |
| Companion-data capability interface | `companion` |

## Consuming it

```jsonc
// package.json
"dependencies": {
  "dash-core": "github:SilentNinja06/dash_core_obs#v0.1.0"
}
```

```ts
import { TodoStore, parseICS, eventsOnDate, DirectivesStore } from "dash-core";
```

`main`/`module`/`types` all point at `src/index.ts`; consumers' esbuild bundles
the TypeScript source directly and externalizes `obsidian` exactly as they
already do.

## Development

```bash
npm install
npm run typecheck   # tsc -noEmit
npm test            # zero-dependency harness, bundled through esbuild
```

## Styling contract (for consumers)

Core panels are **unstyled**: they emit neutral `dash-*` DOM classes (e.g.
`dash-placard`, `dash-btn`, `dash-agenda-row`, `dash-week-cell`) and a few inline
`var(--dash-*)` custom properties (e.g. `--dash-cal-local` for the local-event
swatch). Each consuming dashboard ships its **own** `styles.css` that targets
these `dash-*` classes and defines the `--dash-*` custom properties with its own
palette — so a host's branding (colours, prefixes, voice) lives entirely in that
host, never in core. Keep the class/variable names in sync between your CSS and
this library when you upgrade.
