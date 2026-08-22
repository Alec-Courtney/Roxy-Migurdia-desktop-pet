# Windows transparent-window geometry regressions

This document is a mandatory pre-read before modifying window size or position, right/bottom edge interaction, drag state, or the renderer poster/handoff layers. The two incidents below were caused by different attempts to move or resize the same transparent `BrowserWindow`; fixing one carelessly can restore the other.

## Invariants

1. Right/bottom dock transitions keep the native window at the configured normal size. They move it with one canonical `setBounds({ x, y, ...configuredSize })` rectangle. Entry uses the top-left transition `setShape()` crop; the held state uses one padded rectangle covering the held pose and every wave frame. Do not change the logical window size at an enter/exit/wave endpoint.
2. A decoded dock poster must already cover the sprite before dock geometry or clip source changes. A decoded front handoff must cover the final dock-to-standing publication. Ownership leases/tokens must prevent stale asynchronous cleanup from removing a newer cover.
3. Only free-standing drag uses the extra drag pose. A click or drag from right/bottom dock state uses its return animation and must not expose the standing/drag frame first.
4. Keep the window `resizable:false`, `frame:false`, `transparent:true`, and `thickFrame:false`. Do not call `setResizable()` at runtime. Every ordinary move must include canonical width/height from `WINDOW_SIZES`; never reuse width/height read from `getBounds()`.
5. Round pointer-derived screen coordinates exactly once before calling Electron's integer bounds API. Never send fractional coordinates to the native window API.
6. Water and storm are deliberate large-canvas actions outside the fixed dock-canvas policy. Their actual size changes must remain isolated from drag and dock transitions.
7. A click exit schedules the same four-second quiet delay as a normal drag released in the edge range, and only after the standing handoff commits. Actual pointer movement cancels that pending return. Keep both paths on the single `EDGE_REDOCK_QUIET_MS` constant.
8. Transparent pixels do not automatically pass mouse input through a frameless Electron window. Keep the held dock shape separate from the broader transition shape. Derive it from the canonical held/wave alpha union with conservative padding; never shrink it per frame or replace it with renderer-only `pointer-events` filtering.

## Incident 1: a standing frame flashed during edge interaction

### Symptom

At the end of entering or leaving the right/bottom edge, and sometimes when starting a dock wave or clicking a docked pet, one ordinary standing frame appeared even though every frame in the animation asset was correct.

### Cause

The flash correlated with changing the native size of the transparent frameless window. Electron documents `setBounds()` as a combined move/resize operation, and historical Electron reports show frameless resize flicker. The precise one-frame mechanism is an engineering inference: the Windows/Chromium native surface, renderer image decode, and compositor commit did not become visible atomically, so a stale standing surface could be presented between them. This is not an asset-frame defect.

### Fix

- Keep one configured-size native canvas for normal and dock states.
- Reproduce the video's right/bottom crop with `setShape()` instead of shrinking the `BrowserWindow`.
- Stage an independent, decoded `dockPoster` above the sprite before native dock geometry changes; retain it until the requested WebP source is loaded and compositor-painted.
- On exit, select the final free position first, then cover the state handoff with the decoded `frontHandoff` until standing is compositor-painted.
- Keep poster/handoff ownership tokenized so old timeouts or `finally` blocks cannot uncover a newer transition.
- Never perform a late geometry repair at an animation endpoint.

## Incident 2: dragging gradually enlarged the pet

### Symptom and measurement

Holding the left button did nothing, but every actual pointer move enlarged the free-standing pet. Dock media looked normal and returning to free state restored the enlarged appearance. On the 125% Windows display the configured medium window was `170 x 270`, while a repeatedly dragged packaged process reached `336 x 446`. A controlled 50-move reproduction grew an approximately `172 x 272` native/content viewport to about `224 x 322`. Renderer sway/rotation values did not accumulate.

The different dock appearance was diagnostic: free state fills the current viewport, while dock media is explicitly laid out against the fixed configured normal dimensions. The native window had grown; the character image itself had not been scaled by drag code.

### Cause

Electron has both a historical report of `setPosition()` increasing window size by 1-3 DIP per call at 125% scale and a recent Windows regression for moving `frame:false, resizable:false` windows. At fractional DPI, Electron/Chromium repeatedly converts integral DIP bounds to physical pixels and back with inconsistent rounding; `setPosition()` can therefore feed a rounded native width/height into the next move and accumulate drift.

### Fix

Replace repeated `setPosition()` with `setBounds({ x, y, width, height }, false)`, where `x/y` are rounded once and `width/height` always come from the configured `WINDOW_SIZES` entry (or an equally trusted fixed dock layout derived from it). Never use the current native width/height as input. On the actual 125% display, 120 moves with this fixed rectangle kept native bounds, content size, and the renderer viewport at approximately `171 x 271` and added zero resize events.

Changing only the constructor to `resizable:true + thickFrame:false` was also tested and rejected: despite the HWND having no `WS_THICKFRAME`, the same 120 moves grew native bounds to about `365 x 469`. Do not restore that attempted workaround.

## Incident 3: the transparent area above a docked pet intercepted clicks

### Symptom

While the pet was held above the taskbar, a large visually transparent area above the character still reacted to clicks and blocked the application below it.

### Cause

The fixed native canvas was correctly cropped with `setShape()`, but the same broad top-left rectangle had to include every frame of the entry animation. Electron does not use an image's alpha channel as the native input region, and the renderer's `#pet` element covers the whole canvas. For the medium bottom state the transition shape was about `170 x 262`, while the held pose and all wave frames occupied only about `x=33..127, y=192..260`.

### Fix

- Preserve the broad transition shape throughout entry so moving character pixels are never clipped.
- After entry playback has reached its held frame, shrink only the native shape to one conservatively padded rectangle containing the held pose and the alpha union of every wave frame.
- Keep that one shape unchanged during idle and wave playback. Do not perform per-frame native shape updates.
- On click or dock drag exit, keep the established decoded-poster handoff and fixed-size move before clearing the shape. Never resize the `BrowserWindow` to match either shape.
- Recompute and reapply the correct held shape after a display-metrics or configured-size change.

## Forbidden shortcuts

- Do not hide native growth by giving the sprite a hard-coded CSS size; the hitbox and viewport would still grow.
- Do not use `setPosition()` for repeated ordinary or dock movement on fractional-DPI Windows.
- Do not use `setSize()`, and do not use `setBounds()` with a width/height different from the configured logical size during drag or dock transitions. A canonical same-size `setBounds()` is the required move workaround; a real size change is still forbidden there.
- Do not derive a repair size from `getBounds()` after drift has begun. The source of truth is `WINDOW_SIZES[settings.size]`.
- Do not toggle `resizable` during interaction or change the constructor to the rejected `resizable:true` workaround.
- Do not merge `dockPoster` and `frontHandoff` into the live sprite element or remove their ownership checks.
- Do not add standing/drag publication to dock click, dock drag, wave, or dock transition paths.
- Do not rely on transparent WebP pixels, CSS `pointer-events`, or a full-window `setIgnoreMouseEvents()` toggle as a substitute for the held native dock shape.

## Required regression checks

After a related change:

1. Run `pnpm test`.
2. Test on a real Windows display at 125% scaling. For every configured size, perform at least 100 pointer moves and verify `BrowserWindow.getBounds()`, content size, renderer `innerWidth/innerHeight`, and the character rectangle do not accumulate width/height changes. A one-time platform rounding difference is acceptable; monotonic drift is not.
3. Confirm the transparent window remains non-resizable and that ordinary dragging emits no renderer `resize` events.
4. Exercise right and bottom enter, idle/wave, click exit, dock drag exit, and automatic return. Sample transition frames and confirm no standing or standing-drag source is exposed before the front handoff completes.
5. Confirm no geometry resize happens at a dock animation endpoint and that `setShape()` is cleared only after the free-position move is covered.
6. Click a docked pet without dragging. After its exit animation and standing handoff finish, confirm it stays free for four seconds and then re-enters the same edge; confirm real dragging cancels this pending return.
7. Smoke-test the packaged portable executable, not only `pnpm start`, because Electron/Windows behavior is the subject of these regressions.
8. In each configured size, click the transparent area above and beside a held right/bottom pet and confirm the click reaches the window behind it. Then click and drag the visible character and confirm exit, wave, and pointer capture still work without clipping.

## Upstream references

- [Electron issue #9477: `setPosition` changed size at 125%](https://github.com/electron/electron/issues/9477)
- [Electron issue #51996: moving a frameless non-resizable window changes its size](https://github.com/electron/electron/issues/51996)
- [Electron issue #51572: confirmed frameless bounds rounding at DPI above 100%](https://github.com/electron/electron/issues/51572)
- [Electron `setPosition()` API (integer coordinates)](https://www.electronjs.org/docs/latest/api/browser-window#winsetpositionx-y-animate)
- [Electron `setBounds()` API](https://www.electronjs.org/docs/latest/api/browser-window#winsetboundsbounds-animate)
- [Electron `setShape()` API](https://www.electronjs.org/docs/latest/api/base-window#winsetshaperects-windows-linux-experimental)
- [Electron issue #1671: frameless window resize flicker](https://github.com/electron/electron/issues/1671)
