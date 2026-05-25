# Changelog
All notable changes to **Mermaid NG — Visual Editor** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] — 2026-05-25

### Added

- **Per-node "+" button → shape picker for one-click flow building (flowchart).** Hovering a flowchart node reveals a small green "+" button just below it (native "Add a connected node" tooltip). The button and its picker strip live in a top-z-index SVG overlay so they always sit above neighbouring nodes, and JS-driven hover with a 200 ms grace timer keeps them visible while the cursor travels from node to button (plus an invisible bridge hit-area covers the gap). Clicking the "+" opens a 4-icon shape picker — Process box, Rounded, Circle, Decision — anchored under the button. Picking a shape appends `${source} --> ${newDecl}` and Mermaid re-lays out automatically. Clicking outside the picker (or picking a shape) closes it. If the source node is inside a subgraph, the new node lands inside the same subgraph. Implements [#5](https://github.com/NextGenPowerToys/mermaid-visual-editor/issues/5).

- **Multi-line labels everywhere.** The edit modal's name / label field is now a textarea, so plain **Enter** inserts a line break and **Cmd/Ctrl+Enter** submits. Real newlines are written to the Mermaid source as the standard `\n` escape (e.g. `A["Line 1\nLine 2"]`, `B -->|"Step 1\nStep 2"| C`, `S1 : "Idle\nwaiting for input"`), and the source is decoded back to real newlines when the modal re-opens so labels round-trip cleanly. Works across flowchart node labels, edge labels (pipe + colon forms), state / class / ER node-label fallbacks, and subgraph titles.

- **Default color palette + recently used in the edit modal.** Fill / border color fields now show a curated 16-swatch default palette and a "Recently used" grid above the color picker. Click any swatch to set the color and mark "apply color". The recents list is seeded from the chart's own existing `style` / `linkStyle` / `classDef` declarations every time the modal opens — so opening an existing diagram with colours immediately surfaces those in **Recently used** — and grows as you apply new colours during the session (most-recent first, capped at 14, 3-char hex normalised so `#fff` and `#FFFFFF` dedupe).

## [2.3.0] — 2026-05-23

### Added

- **Programmatic direct-open API for `mermaidVisualEditor.openFromFile`.** The command now accepts an optional second argument — `{ source?: string, index?: number }` — that names a specific diagram inside a multi-diagram file. When the hint matches a block, the thumbnail picker is skipped and the visual editor opens that diagram active (with sibling diagrams from the same file still loaded as inactive sheets). Content match (`source`) wins over `index`, so callers whose block ordering ever drifts from ours still land on the right diagram. Invocations without the second arg behave exactly as before — the thumbnail picker shows for multi-diagram files, the single editor opens for one-diagram files. This is the integration hook used by the **RTF Markdown Editor v3.2.0**: clicking a diagram in its WYSIWYG canvas now hands off the picked diagram directly here.

```ts
// Open the diagram with this exact source, skipping the picker.
await vscode.commands.executeCommand(
  'mermaidVisualEditor.openFromFile',
  fileUri,
  { source: diagramCode },
);

// Or by index in document order (0-based).
await vscode.commands.executeCommand(
  'mermaidVisualEditor.openFromFile',
  fileUri,
  { index: 2 },
);
```

## [2.2.1] — 2026-05-22
### Fixed
- **Editor layout collapsed when opening from an existing file.** The right column showed only the Mermaid-code panel at the top with a large empty area below, and the Canvas panel was missing entirely. The workspace CSS Grid had no explicit `grid-template-rows`, so its single implicit row sized to content (~200px). That left the right column with no definite height, collapsing its `1fr` Canvas track to 0px. An explicit `minmax(0, 1fr)` row now forces the workspace to fill the available flex height so the Canvas track expands correctly.

## [2.2.0] — 2026-05-19
### Added
- **Resizable + collapsible panels.** The Palette, Canvas, and Mermaid-code panels now have drag handles between them — drag the vertical splitter to widen / narrow the Palette (the Canvas + code area absorbs the change), drag the horizontal splitter to grow / shrink the code panel (the Canvas absorbs the change). Each side panel has a `−` button in its header to hide it; a thin restore strip appears on the matching edge ("Show palette ▸" on the left, "Show code ▴" at the bottom) — click it to bring the panel back. State is per-session; the canvas refits automatically after every resize or show/hide.

## [2.1.0] — 2026-05-19
### Added
- **Connectors are now a toggle, not a draggable snippet.** Edge / relation / transition palette items (flowchart arrows, sequence messages, class relations + cardinalities, state transitions, ER cardinalities) render as toggle buttons instead of draggable rows. Click one to *arm* it (blue fill); drag from one node onto another and the armed connector's syntax is used. Click again to disarm. Picking another connector auto-disarms the previous. With nothing armed, drag-to-connect falls back to the previous defaults (`-->` for flowchart/class/state, `||--o{ : relates` for ER). The "snippet-as-A→B template" convention works for both forward (`A --> B`) and reversed (`B-->>A: reply`) templates — the first identifier in the snippet is treated as the source.

### Fixed
- **Diagram type dropdown stayed on "Flowchart" no matter the file's actual diagram type.** Opening a `sequenceDiagram` / `classDiagram` / `stateDiagram-v2` / `erDiagram` / `gantt` / `pie` / `journey` / `mindmap` / `gitGraph` / `timeline` / `quadrantChart` file rendered the diagram correctly but left the type selector and the palette stuck on flowchart — and changing the dropdown would offer to overwrite the user's code with a starter template. The editor now detects the type from the first meaningful line of code (skipping YAML frontmatter and `%%{init}%%` directives) and syncs the dropdown + palette to the actual diagram, both on initial file open and when switching between sheets in a multi-diagram file.

## [2.0.0] — 2026-05-17
### Changed
- **Mermaid upgraded from 10.9.0 to 11.15.0** (major). The full UMD bundle is still inlined into the editor HTML, so the extension stays fully offline — no CDN, no network calls. Mermaid v11 brings updated diagram renderers, refreshed defaults, and fixes accumulated since 10.9.

### Fixed
- **Drag-to-connect produced an invalid edge** after the v11 upgrade. v11 prepends the diagram container id to every node's SVG id (e.g. `m1-flowchart-A-0` instead of `flowchart-A-0`); the node-id parser unwrapped the wrong layer and inserted edges like `flowchart-A --> ...` into the code. The parser now strips the container prefix correctly for flowchart, state, class, and ER families.

- **"couldn't locate **``**→**``** in code"** when editing an edge label on a flowchart. Two layered bugs: v11's edge id format (`m1-L_A_B_0`) bypassed the v10-shaped parser and fell into a 50/50 fallback that returned `source=L, target=A-B`; even pre-upgrade, that fallback misfired on node ids containing underscores. The parser now handles the v11 prefix, and the call site cross-checks any id-derived parse against the real edge list in the source — falling through to the position-based fallback when the parse doesn't match a real edge.

- **"Mermaid bundle failed to load"** in the multi-diagram thumbnail picker after the upgrade. The bundle extractor in `extension.js` was keyed off the literal string `mermaid 10.9.0`; the marker is now version-independent so future Mermaid bumps won't silently break the picker.

- **Sequence / class / state / ER diagrams rendered tiny and uncentered** when fitted to the canvas. Mermaid emits `width="100%"` + an inline `max-width` for these families (`useMaxWidth: true` is their default), which made the editor's transformed container shrink to canvas width instead of viewBox width — fit math used viewBox dims while the rendered element was canvas-wide, leaving the diagram in the canvas's left third at a too-small scale. The editor now pins each rendered SVG to its intrinsic viewBox dimensions, so fit and center math agree.

### Notes
- **Extension runtime remains fully offline**, no telemetry, no network calls. The bundled Mermaid is now 11.15.0 instead of 10.9.0; the `.vsix` is still self-contained.

## [1.1.0] — 2026-05-17
### Added
- **Azure DevOps Wiki **`::: mermaid ... :::`** container syntax.** Right-click → **Mermaid NG: Open Mermaid Diagrams from File** now picks up diagrams written with either the standard GitHub-flavored ````mermaid` fenced block **or** the colon-container form used by Azure DevOps wiki pages and Pandoc fenced divs. Mixed-style files are supported — blocks from both syntaxes are listed in document order and each block remembers its own fence style on save-back.

- **GitHub Pages landing site** at [https://nextgenpowertoys.github.io/mermaid-visual-editor/](https://nextgenpowertoys.github.io/mermaid-visual-editor/) — hero, feature grid, screenshot gallery, use cases, command reference, install instructions. Full OpenGraph + Twitter Card + [Schema.org](http://Schema.org) `SoftwareApplication` JSON-LD for sharing and SEO.

- **Screenshot gallery** in both READMEs and the landing page — six rendered shots showing the drag-and-drop palette, multi-cloud architecture editing, the diagram-type dropdown, the right-click flow, the multi-diagram thumbnail picker, and the rich edit modal.

- [**CHANGELOG.md**](http://CHANGELOG.md) (this file) shipped at the repo root and inside the extension package so the marketplace's Changelog tab renders it.

### Changed
- **Marketplace listing icon** shrunk to a 128 px right-floated image so it sits next to the intro paragraph instead of dominating the page; the marketplace already shows the package icon in the header chip.

- **Save-back appends inherit the file's dominant fence style.** Add a new sheet to an Azure DevOps wiki page → the appended block is written with `::: mermaid ... :::`; add one to a GitHub-flavored markdown file → backtick fence.

- README image references now use absolute `raw.githubusercontent.com` URLs so they render on the marketplace listing (which rewrites relative paths against the *repository root*, not the extension subfolder).

### Fixed
- Marketplace listing's icon and screenshots render inline again (they were silently broken before the absolute-URL change, because relative paths in this repo's `vscode-extension/` subfolder were being rewritten to non-existent root-level URLs).

### Notes
- The **extension runtime remains fully offline**, no telemetry, no network calls — same as 1.0.0. The README-image change is render-time only (marketplace + Extensions-tab browser), not runtime; the actual editor and picker webviews still load every asset from inside the `.vsix`.

## [1.0.0] — 2026-05-17
First public release of **Mermaid NG — Visual Editor**.

### Highlights
- **WYSIWYG, drag-and-drop visual editor** for Mermaid diagrams inside VSCode. *What you see is what you get* — every canvas action updates the Mermaid source in real time, and every keystroke in the code pane re-renders the canvas.

- **12+ diagram families** — flowchart, sequence, class, state, ER, gantt, pie, journey, mindmap, gitgraph, timeline, quadrant.

- **Multi-sheet (**[**draw.io**](http://draw.io)** style)** — every ````mermaid` block in a markdown file becomes its own tab with its own undo history.

- **Round-trips Markdown in place** — save back rewrites only the diagram blocks; surrounding prose and non-mermaid code fences are preserved.

- **Right-click any **`.md`** / **`.mdx`** / **`.markdown`** / **`.mmd`** / **`.mermaid`** file** to open every diagram inside it — picker-first when there's more than one, direct otherwise.

- **Full undo / redo** (`Cmd/Ctrl+Z`, `Cmd+Shift+Z`, `Ctrl+Y`) for every visual mutation — drag, modal Apply, delete, type — with debounced typing and per-sheet history.

- **Delete** any node or edge via the red Delete button in the edit modal, or by hovering and pressing `Delete` / `Backspace`. Fully undoable.

- **SVG / PNG export** via VSCode's native save dialog; default filenames combine the source file's basename with the diagram's `title:` or the active sheet name (so multi-sheet exports stay distinguishable).

- **Save** button in the canvas toolbar (also bound to `Cmd/Ctrl+S` in the panel) — writes back to source, or opens Save As for scratch panels.

- **Fully offline · no telemetry · no cloud** — Mermaid 10.9.0 is bundled, the extension makes zero network calls at runtime. Works on air-gapped machines.

- Commands surfaced under the **Mermaid NG** category in the command palette.

- MIT-licensed; bundled Mermaid is also MIT-licensed (see [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES)).