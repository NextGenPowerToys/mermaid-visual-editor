# Screenshots

Drop the PNGs you shared into this folder with these exact filenames — they are referenced from both the landing page (`docs/index.html`) and the project README. **Also copy each file into** `vscode-extension/media/screenshots/` so the marketplace listing renders them from inside the `.vsix`.

| Filename | What it shows |
| --- | --- |
| `01-diagram-types.png` | Diagram-type dropdown open — every supported family in one place (Flowchart, Sequence, Class, State, Entity-Relationship, Gantt, Pie, Journey, Mindmap, Git, Timeline, Quadrant). |
| `02-drag-to-add.png` | Drag-and-drop in progress — palette item being dragged onto the canvas with the **Drop to add** target highlighted. |
| `03-after-drop.png` | Right after dropping — a new node appears on the canvas **and** the corresponding `E[Process box]` line is appended to the Mermaid code, illustrating the two-way binding. |
| `04-right-click-menu.png` | Explorer right-click menu on a markdown file showing **Mermaid NG: Open Mermaid Diagrams from File**. |
| `05-picker.png` | Multi-diagram thumbnail picker — each diagram rendered as a clickable SVG card with its line number, so you can pick which one to open. |
| `06-architecture.png` | A complex multi-cloud architecture diagram (subgraphs for Internet / AWS / Azure) loaded for visual editing — proof the canvas handles non-trivial real-world diagrams. |
| `07-er-editor.png` | The Edit-entity modal for an ER entity: name, dynamic attribute list with PK/FK/UK keys, border line, fill colour, border colour, and the destructive **Delete entity** button. |

Quick copy after dropping into `docs/screenshots/`:

```sh
cp docs/screenshots/*.png vscode-extension/media/screenshots/
```
