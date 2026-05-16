# Mermaid Visual Editor

A drag-and-drop, multi-sheet Mermaid diagram editor for VSCode. Edits `.md` / `.mmd` files in place, exports SVG/PNG, runs fully offline with Mermaid 10.9.0 bundled.

By [NGPowerToys](https://github.com/NextGenPowerToys).

## Repository layout

```text
mermaid-visual-editor/
├── vscode-extension/           the VSCode extension (this is what users install)
│   ├── package.json
│   ├── extension.js
│   ├── README.md               extension docs — full feature list & usage
│   └── media/
│       └── mermaid-editor.html the self-contained editor (Mermaid bundled)
├── mermaid-editor-offline.html   reference: original single-file editor
└── mermaid-editor-offline_3.html reference: latest single-file editor snapshot
```

The standalone `mermaid-editor-offline*.html` files in the repo root are kept for reference / browser use — the extension bundles a copy as `vscode-extension/media/mermaid-editor.html` and wraps it in a webview.

## Install the extension

See [vscode-extension/README.md](vscode-extension/README.md) for the full feature list, commands, and packaging instructions.

Quick version:

```sh
cd vscode-extension
npm i -g @vscode/vsce
vsce package --allow-missing-repository
code --install-extension mermaid-visual-editor-0.3.0.vsix
```

Or open `vscode-extension/` in VSCode and press `F5` to launch an extension dev host.

## License

MIT — see [LICENSE](LICENSE).
