# Changelog

All notable changes to **Mermaid NG — Visual Editor** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-05-17

### Added

- **Azure DevOps Wiki `::: mermaid ... :::` container syntax.** Right-click → **Mermaid NG: Open Mermaid Diagrams from File** now picks up diagrams written with either the standard GitHub-flavored ```` ```mermaid ```` fenced block **or** the colon-container form used by Azure DevOps wiki pages and Pandoc fenced divs. Mixed-style files are supported — blocks from both syntaxes are listed in document order and each block remembers its own fence style on save-back.
- **GitHub Pages landing site** at <https://nextgenpowertoys.github.io/mermaid-visual-editor/> — hero, feature grid, screenshot gallery, use cases, command reference, install instructions. Full OpenGraph + Twitter Card + Schema.org `SoftwareApplication` JSON-LD for sharing and SEO.
- **Screenshot gallery** in both READMEs and the landing page — six rendered shots showing the drag-and-drop palette, multi-cloud architecture editing, the diagram-type dropdown, the right-click flow, the multi-diagram thumbnail picker, and the rich edit modal.
- **CHANGELOG.md** (this file) shipped at the repo root and inside the extension package so the marketplace's Changelog tab renders it.

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
- **Multi-sheet (draw.io style)** — every ```` ```mermaid ```` block in a markdown file becomes its own tab with its own undo history.
- **Round-trips Markdown in place** — save back rewrites only the diagram blocks; surrounding prose and non-mermaid code fences are preserved.
- **Right-click any `.md` / `.mdx` / `.markdown` / `.mmd` / `.mermaid` file** to open every diagram inside it — picker-first when there's more than one, direct otherwise.
- **Full undo / redo** (`Cmd/Ctrl+Z`, `Cmd+Shift+Z`, `Ctrl+Y`) for every visual mutation — drag, modal Apply, delete, type — with debounced typing and per-sheet history.
- **Delete** any node or edge via the red Delete button in the edit modal, or by hovering and pressing `Delete` / `Backspace`. Fully undoable.
- **SVG / PNG export** via VSCode's native save dialog; default filenames combine the source file's basename with the diagram's `title:` or the active sheet name (so multi-sheet exports stay distinguishable).
- **Save** button in the canvas toolbar (also bound to `Cmd/Ctrl+S` in the panel) — writes back to source, or opens Save As for scratch panels.
- **Fully offline · no telemetry · no cloud** — Mermaid 10.9.0 is bundled, the extension makes zero network calls at runtime. Works on air-gapped machines.
- Commands surfaced under the **Mermaid NG** category in the command palette.
- MIT-licensed; bundled Mermaid is also MIT-licensed (see [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES)).
