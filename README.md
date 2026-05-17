# Mermaid NG — Visual Editor

![Mermaid NG — Visual Editor](vscode-extension/media/icon-hd.png)

**Drag-and-drop visual editor for AI-friendly Mermaid diagrams.** Built for architects and developers who want to *see* their flowcharts, sequence diagrams, class / ER / state models, gantt charts and mindmaps while building them — and round-trip them into the same `.md` or `.mmd` files they live in.

- Multi-sheet (draw.io style) — every ```` ```mermaid ```` block in a markdown file becomes a tab.
- Save back rewrites only the diagram blocks; surrounding prose is preserved.
- SVG / PNG export with sensible default filenames.
- Fully offline — Mermaid 10.9.0 is bundled, no network calls.
- Full undo / redo, palette drag, click-to-connect, double-click-to-edit, hover-to-delete.

A [NGPowerToys](https://github.com/NextGenPowerToys) extension.

## Repository layout

```text
mermaid-visual-editor/
├── vscode-extension/           the VSCode extension (this is what users install)
│   ├── package.json
│   ├── extension.js            host: webview, picker, save-back, exports
│   ├── README.md               extension docs — full feature list & usage
│   └── media/
│       ├── mermaid-editor.html the self-contained editor (Mermaid 10.9.0 bundled)
│       ├── icon.png            marketplace icon (256×256)
│       └── icon-hd.png         hi-res hero image for the README
├── LICENSE                     MIT
└── THIRD-PARTY-LICENSES        Mermaid MIT notice
```

## Install

The fastest path is the marketplace, but you can also install the `.vsix` directly:

```sh
cd vscode-extension
npm i -g @vscode/vsce
vsce package --allow-missing-repository
code --install-extension mermaid-visual-editor-1.0.0.vsix
```

Or open `vscode-extension/` in VSCode and press `F5` to launch an extension dev host.

See [vscode-extension/README.md](vscode-extension/README.md) for the full feature list, command reference, and usage instructions.

## License

This project's source code is licensed under the MIT License — see [LICENSE](LICENSE).

## Third-party

This project bundles [Mermaid](https://github.com/mermaid-js/mermaid) (v10.9.0), © 2014–2022 Knut Sveidqvist, also under the MIT License. Full text in [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES); a copy is also embedded as an HTML comment inside [vscode-extension/media/mermaid-editor.html](vscode-extension/media/mermaid-editor.html) so the editor file remains compliant when distributed standalone.
