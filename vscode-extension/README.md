# Mermaid Visual Editor

A VSCode extension by **[NGPowerToys](https://github.com/NextGenPowerToys)** — an offline, drag-and-drop Mermaid diagram editor that runs entirely inside a VSCode webview. Mermaid 10.9.0 is bundled, no network access required.

Edit any `.md`, `.mdx`, `.markdown`, `.mmd`, or `.mermaid` file visually. Multi-diagram markdown files open as draw.io-style tabs; saving replaces every diagram in the source in place.

## Commands

| Command | Description |
| --- | --- |
| `Mermaid: Open Visual Editor` | Opens an empty visual editor in a new panel. |
| `Mermaid: Open Visual Editor with Selection` | Opens the editor seeded with the current text editor selection. |
| `Mermaid: Open Mermaid Diagrams from File` | Scans the file for diagrams. With one diagram opens it directly; with multiple shows a thumbnail picker. |
| `Mermaid: Insert Current Diagram into Active Editor` | Inserts the most recently focused panel's code at the cursor (or replaces the selection) in the active text editor. |
| `Mermaid: Save Diagram Back to Source File` | Bound to `Cmd/Ctrl+S` while the editor panel is focused. If the panel was opened from a file, rewrites every sheet back into the source. If not, opens a Save As dialog and creates a new file. |

## Open from a file (right-click)

The extension contributes a context-menu entry for `.md`, `.mdx`, `.markdown`,
`.mmd`, and `.mermaid` files in three places:

- **Explorer right-click → "Open Mermaid Diagrams from File"**
- **Editor right-click → "Open Mermaid Diagrams from File"**
- **Editor tab right-click → "Open Mermaid Diagrams from File"**

What happens depends on what the file contains:

| File contents | Result |
| --- | --- |
| `.mmd` / `.mermaid` (single diagram) | Visual editor opens directly. |
| One ```` ```mermaid ```` fenced block in a markdown file | Visual editor opens directly. |
| Multiple fenced ```` ```mermaid ```` blocks | A picker panel opens with rendered SVG thumbnails of each diagram. Click one to open all of them as sheets in the editor, with that one active. |
| No mermaid blocks | A warning notification. |

## Multi-sheet (draw.io style)

When the source file has multiple ```` ```mermaid ```` blocks, the editor shows a tab bar at the bottom — one tab per diagram. Each tab keeps its own code; switching tabs swaps the canvas. Sheet names come from each diagram's `title:` (YAML frontmatter or inline `title …`), falling back to `Sheet N`.

- **Click** a tab to switch.
- **Double-click** to rename (in-memory).
- **× on a tab** to delete that sheet.
- **+ Add sheet** for a new blank diagram.

On Save:

- **Markdown sources** — every sheet is written back to the file, replacing each existing block in place. Added sheets append at the end; removed sheets are stripped. Surrounding prose and non-mermaid code blocks are preserved.
- **`.mmd` / `.mermaid` sources** — only one diagram per file by format, so the **active** sheet wins; a warning fires if other sheets would be lost (use Save As → markdown to keep them all).

## Save and Save As

Every editor panel shows a primary **Save** button in the canvas toolbar, also bound to `Cmd/Ctrl+S`:

- If the panel was opened from a file → overwrites that file with the current sheets.
- If the panel is a scratch panel → opens a Save As dialog (defaults to `.md`, also offering `.mmd`) and creates the file. The panel is then linked to it, so further saves overwrite.

Default filenames for Save As come from the diagram's `title:` (or the active sheet's name), falling back to `diagram`.

## SVG / PNG export

The `SVG` and `PNG` buttons in the canvas toolbar export the current sheet to disk via VSCode's native save dialog. Default filenames combine the source file's basename with the diagram title or active sheet name, so multi-sheet exports stay distinguishable (e.g. `README-Auth-Flow.svg`).

## Try it from source

From this folder:

```sh
npm i -g @vscode/vsce
vsce package --allow-missing-repository
code --install-extension mermaid-visual-editor-0.3.0.vsix
```

Or, to run a development host:

1. Open this `vscode-extension/` folder in VSCode.
2. Press `F5` (Run and Debug → "Extension"). VSCode launches a second
   window with the extension loaded.
3. In the new window, right-click any `.md` or `.mmd` file and pick **Open
   Mermaid Diagrams from File**, or open the command palette and run **Mermaid:
   Open Visual Editor**.

## Layout

```text
vscode-extension/
├── package.json              extension manifest + command/menu contributions
├── extension.js              activation entry point, webview hosts, block parser
└── media/
    └── mermaid-editor.html   the self-contained editor (Mermaid 10.9.0 inlined)
```

`extension.js`:

- opens the editor in a webview, injecting a CSP `<meta>` and a small
  `acquireVsCodeApi()` bridge so the host can prefill the textarea, read all
  sheets back, and handle save / export.
- parses markdown files for ```` ```mermaid ```` fenced blocks (and treats
  `.mmd`/`.mermaid` as a single whole-file block).
- for multi-diagram files, builds a picker webview at runtime, slicing the
  Mermaid bundle out of `mermaid-editor.html` and reusing it to render the
  thumbnails — so there is still only one copy of the Mermaid library on disk.
- on save, walks the source file's blocks last-to-first to replace each one
  in place, preserving non-mermaid content.

## License

This extension's source code is licensed under the MIT License — see [LICENSE](LICENSE).

## Third-party

This extension bundles [Mermaid](https://github.com/mermaid-js/mermaid) (v10.9.0), © 2014–2022 Knut Sveidqvist, also under the MIT License. Full text in [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES); a copy is also embedded as an HTML comment inside [media/mermaid-editor.html](media/mermaid-editor.html).
