# Minesweeper Solver

Ein Minesweeper-Analyzer, der einen unvollständig aufgedeckten Spielzustand entgegennimmt und für jedes verdeckte Feld die Wahrscheinlichkeit berechnet, dass dort eine Mine liegt. Sichere Züge und garantierte Minen werden direkt markiert.

Das Repo enthält zwei eigenständige Implementierungen derselben Solver-Logik:

- **[`minesweeper_solver.py`](minesweeper_solver.py)** — Python-CLI für ein hartcodiertes Beispielbrett.
- **[`app/`](app/)** — Vite + React + Tailwind GUI mit interaktivem Brett, Bemalung per Maus, Wahrscheinlichkeits-Heatmap und einem Screenshot-Scanner, der ein Spielbild per Pixelanalyse einliest.

## Solver-Pipeline

1. **Deterministische Deduktion** — pro nummerierter Zelle Constraints `(verbleibende_minen, unbekannte_nachbarn)` aufstellen; trivial auflösen (`remaining == 0` → alle sicher, `remaining == |unknowns|` → alle Minen) und paarweise Subset-Reduktion (z. B. das klassische 1-2-1-Muster).
2. **Frontier-Gruppierung** — die unbekannten Randzellen werden über geteilte Constraints in Connected Components zerlegt.
3. **Enumeration** — pro Gruppe werden alle gültigen Minenkonfigurationen aufgezählt (bis ~22–25 Zellen pro Gruppe). Daraus pro Zelle die exakte Minenwahrscheinlichkeit.
4. **Globale Gewichtung** (nur GUI) — die Restminenzahl gewichtet die Konfigurationen über `C(non_frontier, mines_left - m)`, damit Non-Frontier-Zellen eine sinnvolle Wahrscheinlichkeit bekommen.

## Python-CLI starten

```bash
python minesweeper_solver.py
```

Gibt das hartcodierte Beispielbrett unten in der Datei mit Phase-1- und Phase-2-Ergebnissen aus. Eigenes Brett: das `board_raw`-Array am Ende der Datei anpassen (`0`–`8` für Zahlen, `'F'` für Flagge, `'?'` für verdeckt).

## GUI starten

Voraussetzung: Node.js ≥ 18.

```bash
cd app
npm install
npm run dev
```

Vite öffnet die App auf <http://localhost:5173>.

### Bedienung

- **Malen**: Paint-Tool in der Sidebar wählen, Zellen klicken oder ziehen. Rechtsklick zykelt durch die Zustände.
- **Tastenkürzel**: `1`–`8` Zahlen, `U` unbekannt, `F` Flagge, `.` leer, `S` solve, `Strg+V` Screenshot einfügen.
- **Solve**: grün ✓ = sicher, rot X = Mine, Zahl = Minenwahrscheinlichkeit in %. Die Sidebar listet die besten Züge sortiert nach Risiko.
- **Screenshot-Scanner**: Bild eines laufenden Minesweeper kopieren, im Tab `Strg+V` drücken. Rechteck über das Grid ziehen, Rows/Cols passend einstellen, *Detect* → *Apply to Board*. Die Klassifizierung ist heuristisch (Pixelfarben) und kann je nach Theme nachgebessert werden müssen.

## Bekannte Einschränkungen

- Kein echtes Spiel — die Tools analysieren nur Zustände, sie generieren keine Bretter und es gibt keinen Aufdeck-Mechanismus.
- Im Python-Solver wird der `total_mines`-Parameter nicht in die Wahrscheinlichkeitsberechnung einbezogen (Non-Frontier-Zellen bekommen pauschal 0.5). Die GUI berücksichtigt die Restminenzahl korrekt.
- Frontier-Gruppen über ~22 (GUI) bzw. ~25 (Python) Zellen fallen auf eine grobe Heuristik zurück.
- Der Bildscanner ist auf typische dunkle Themes abgestimmt; bei exotischen Farbpaletten kann die Klassifizierung der Ziffern 5–8 ungenau werden.

## Projektstruktur

```
minesweeper/
├── minesweeper_solver.py     Python-CLI-Solver
├── minesweeper_gui.jsx       Original-Standalone-Komponente
└── app/                      Vite + React + Tailwind Setup
    ├── src/
    │   ├── App.jsx
    │   ├── main.jsx
    │   ├── index.css
    │   └── minesweeper_gui.jsx
    ├── tailwind.config.js
    └── package.json
```
