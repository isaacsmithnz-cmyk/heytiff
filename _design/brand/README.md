# HeyTiff — Logo Files

Drop-in assets for the app. All marks are vector; the chevron is the brand mark, the
wordmark is Plus Jakarta Sans 800.

## Files
- `heytiff-logo-full.svg` — chevron + wordmark lockup (gradient mark, requires Plus Jakarta Sans 800)
- `heytiff-chevron.svg` — chevron only, brand gradient (teal→blue)
- `heytiff-chevron-mono.svg` — chevron only, single colour via `currentColor`
- `heytiff-wordmark.svg` — "HeyTiff" wordmark only (requires Plus Jakarta Sans 800)

## Colour
- Teal `#00E5C0` · Teal-AA `#00A389` (use on light for the "Tiff" accent — passes AA)
- Blue `#2E68FF` · Ink `#0A0B10`
- Mark gradient: 135°, `#00E5C0 → #2E68FF`

## Usage notes
- **App icon / favicon:** use `heytiff-chevron.svg` centered in a rounded ink (`#0A0B10`) tile.
- **One-colour print / embroidery / over photos:** use `heytiff-chevron-mono.svg` — it inherits
  `color` (set ink `#0A0B10` on light, white on dark). The gradient version is screen-only.
- **Clear space:** keep padding ≥ the cap-height of the "H" on all sides.
- **Minimum size:** full lockup ≥ 120px wide; chevron icon ≥ 16px.
- **Wordmark font:** link Plus Jakarta Sans 800, or outline the text in `heytiff-wordmark.svg`
  / `heytiff-logo-full.svg` for fully static use (so it renders without the webfont).

`HeyTiff - Logo Kit.html` is the visual reference sheet showing every variant in context.
