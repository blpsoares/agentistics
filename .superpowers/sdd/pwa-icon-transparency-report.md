# PWA Icon Black Plate — Fix Report

**Journey:** j-20260826-cy — agentistics/web
**Date:** 2026-08-26

## Problem

The installed PWA icon (taskbar/dock) rendered as a **filled near-black square**
around the circular glyph, instead of the mark sitting cleanly on transparency.

## Scope

In: `packages/web/public/icons/*.png` (the four asset files) and the PWA manifest
declared in `packages/web/vite.config.ts` (`VitePWA({ manifest: ... })`). Out: the
mark/glyph artwork itself, `favicon.ico` / `favicon-central.ico` (verified
unaffected, see below), and `packages/server/server/central-branding.ts` (server
package — out of this unit's scope; see Follow-up).

## Acceptance

- Icon PNGs have a real alpha channel, no baked opaque backdrop — confirmed by
  decoding pixels, not assumed.
- Manifest declares `any` and `maskable` purposes on separate, correct assets.
- Favicon still resolves in a browser tab.
- `bun tsc --noEmit`, `bun test packages/web`, `bun run build` stay green.
- OS-taskbar render is called out as **not fully verified** — no tool in this
  session's harness can capture the OS chrome/taskbar itself (see Verification).

---

## Diagnosis

Both suspected causes were real:

1. **The black square was baked into the PNGs themselves**, not painted by the
   manifest. All four icons (`icon-192`, `icon-512`, `icon-central-192`,
   `icon-central-512`) were RGBA but fully opaque
   (`identify -format '%[opaque]'` → `true`), with the corner pixel exactly
   `rgba(15,15,18,255)` — the same value as the manifest's own
   `background_color: '#0f0f12'`. `packages/web/scripts/gen-central-icons.py`'s own
   comment confirms this was deliberate at the time: *"leaving the near-black plate
   and its glow untouched."* Any platform that draws an "any"-purpose icon verbatim
   (Windows taskbar, macOS dock, Linux) shows that opaque backdrop as a square.

2. **The manifest compounded it.** `icon-512.png` was declared with
   `purpose: 'any maskable'` — one file serving both purposes. A maskable icon must
   fill the canvas edge-to-edge with its important content confined to an ~80%
   safe-zone circle (the OS crops the rest to its own shape); this file had neither
   the safe-zone margin nor a matching "any"-only sibling, so the *same* edge-to-edge
   plate was also what any non-masking platform received as the plain icon.

   `background_color` / `theme_color` were checked and are **not** contributing —
   `background_color` only paints the PWA splash screen while it loads, and
   `theme_color` themes browser chrome; neither is read by the OS when drawing an
   installed app's taskbar/dock icon. No change made to either.

## Fix

1. **Made all four icon PNGs transparent.** The background is a near-uniform flat
   color, so it was removed via a color-distance alpha ramp (pixels within 6 units
   of `#0f0f12` → fully transparent, beyond 45 units → fully opaque, linear ramp
   between) rather than a hard cutout — this keeps the existing soft glow fading
   into nothing instead of fading into a solid square. The glyph artwork itself is
   untouched.

2. **Added dedicated maskable variants** — `icon-192-maskable.png` /
   `icon-512-maskable.png` (+ `-central-` counterparts, generated for parity even
   though nothing currently serves them — see Follow-up): the transparent glyph
   scaled down and centered so its farthest point sits inside the 80%-diameter
   safe-zone circle, composited onto an **opaque** plate in the original plate
   color. Maskable icons must stay opaque edge-to-edge or an OS mask crops to holes
   — that opacity is correct there, only the "any" icon needed to lose it.

3. **Split the manifest** (`packages/web/vite.config.ts`) into four icon entries:
   `icon-192`/`icon-512` as `purpose: 'any'` (now transparent), and the two new
   files as `purpose: 'maskable'`. `background_color` / `theme_color` left as-is
   (see Diagnosis — not the cause).

4. Left `favicon.ico` / `favicon-central.ico` / `apple-touch-icon` untouched:
   `favicon.ico`'s corner pixel was already `rgba(0,0,0,0)` — it was never part of
   this bug. `apple-touch-icon` points at `/icons/icon-192.png`, which inherits the
   fix automatically.

---

## Verification

### `bun tsc --noEmit`
Zero errors.

### `bun test packages/web`
```
830 pass
0 fail
3415 expect() calls
Ran 830 tests across 48 files.
```

### `bun run build`
Succeeds; inspected the emitted `packages/web/dist/manifest.webmanifest` — icons
array has the 4 entries with correct `purpose` values, and all 8 PNGs (4 base + 4
maskable + 2 central variants of each) are present in `dist/icons/` and listed in
the service worker's precache manifest (`dist/sw.js`).

### Pixel-level, on disk
`identify -format '%[opaque]'` on the 4 fixed assets → `false` (was `true`).
Corner pixel decoded via Pillow: `(0,0,0,0)` for `icon-192`/`icon-512`/central
variants (previously `(15,15,18,255)`); the two new `*-maskable.png` files decode
opaque at the corner, `(15,15,18,255)`, as intended.

### Pixel-level, through an actual browser (real Chrome, not just local disk)
Served the production build (`vite preview`) and, from a real connected Chrome tab,
fetched `/manifest.webmanifest` and decoded each referenced icon via
`Image`/`canvas.getImageData`:

| icon | corner rgba (as served) |
|---|---|
| `/icons/icon-192.png` (any) | `[0,0,0,0]` |
| `/icons/icon-512.png` (any) | `[0,0,0,0]` |
| `/icons/icon-192-maskable.png` | `[15,15,18,255]` |
| `/icons/icon-512-maskable.png` | `[15,15,18,255]` |

No manifest/icon-related console errors on load (the only console errors present
were from an unrelated third-party browser extension).

### What could **not** be verified: the installed-app icon on the OS taskbar/dock
This session's browser-automation tool only captures the page's own viewport, not
the browser chrome or OS desktop/taskbar, and the `beforeinstallprompt` event did
not fire in a scripted 3s window (Chrome's install-eligibility heuristics need real
user engagement signals this harness can't produce). **Marking the OS-taskbar
render as not-verified** rather than claiming it — someone with hands on the real
desktop needs to install the app and look. Everything upstream of that (asset
transparency, manifest correctness, what the browser actually fetches and decodes)
is verified above.

---

## Follow-up (out of this unit's scope)

`packages/server/server/central-branding.ts`'s `ICON_SWAPS` only maps
`icon-192.png`/`icon-512.png` → their `-central-` counterparts; it does not know
about the two new `*-maskable.png` paths. A running central will therefore still
correctly show the **teal, transparent "any" icon** (the actual bug fix) but its
*maskable* manifest entry will keep pointing at the amber maskable asset. This is
a one-line addition to `ICON_SWAPS` in `packages/server` — left alone here per
scope (`packages/server` is a different journey's unit, currently in flight in
parallel). Central-hued maskable assets (`icon-central-192-maskable.png`,
`icon-central-512-maskable.png`) were generated in this package so that follow-up
only needs the swap-pair line, no new art.

## Gates

**Correction to the brief's assumption:** this repo *does* run CI on every push and
PR — `.github/workflows/ci.yml` (`bun install --frozen-lockfile` → `bun run stub` →
`bun tsc --noEmit` → `bun test` → `bun audit` (non-blocking) →
`git diff --exit-code bun.lock`). All of it passes for this change (verified above;
`bun.lock` is untouched by this PR — an incidental version-string drift from a
plain `bun install` was reverted before committing, since it isn't part of this
fix). So CI *is* a gate here, in addition to QA (Wave 2 — Donald).
