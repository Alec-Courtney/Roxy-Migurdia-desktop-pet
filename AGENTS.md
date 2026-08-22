# Repository agent instructions

## Mandatory pre-read for window and interaction changes

Before changing any `BrowserWindow` option or geometry API, `WINDOW_SIZES`, `movePetWindowTo`, `placeDockCanvas`, `placeNormalCanvas`, drag/dock state, or poster/handoff behavior, read [Windows transparent-window geometry regressions](docs/window-geometry-regressions.md) in full. This also applies to nearby fixes that can affect those paths. Preserve its invariants and run its required regression checks; do not skip this pre-read.
