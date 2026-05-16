# Mermaid Live Editor (VSCode extension)

An offline, drag-and-drop Mermaid diagram editor that runs entirely inside a
VSCode webview. Mermaid 10.9.0 is bundled — the extension makes no network
requests at runtime.

## Commands

| Command | Description |
| --- | --- |
| `Mermaid: Open Live Editor` | Opens an empty live editor in a new panel. |
| `Mermaid: Open Live Editor with Selection` | Opens the editor seeded with the current text editor selection (useful for round-tripping existing `\`\`\`mermaid` blocks). Also added to the editor right-click menu when text is selected. |
| `Mermaid: Insert Current Diagram into Active Editor` | Reads the code from the most recently focused live editor and inserts it at the cursor (or replaces the active selection) in the active text editor. |

## Try it from source

From this folder:

```sh
# install vsce once, globally
npm i -g @vscode/vsce

# package into a .vsix
vsce package --allow-missing-repository

# install the produced .vsix into VSCode
code --install-extension mermaid-live-editor-0.1.0.vsix
```

Or, to run a development host:

1. Open this `vscode-extension/` folder in VSCode.
2. Press <kbd>F5</kbd> (Run and Debug → "Extension"). VSCode launches a second
   window with the extension loaded.
3. In the new window, open the command palette and run **Mermaid: Open Live
   Editor**.

## Layout

```
vscode-extension/
├── package.json              extension manifest + command contributions
├── extension.js              activation entry point (registers commands, hosts webview)
└── media/
    └── mermaid-editor.html   the original self-contained editor (Mermaid 10.9.0 inlined)
```

`extension.js` reads `media/mermaid-editor.html` at panel-open time, prepends a
CSP `<meta>` tag permitting the inline scripts and styles the page relies on,
and appends a small bridge `<script>` that uses `acquireVsCodeApi()` to talk
back to the extension host (for prefilling the textarea from a selection and
for handing the current code back when the insert command runs).
