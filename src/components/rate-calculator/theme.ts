/* Rate Calculator tokens — the HeyTiff system.
   Palette: teal #00E5C0 (accent), teal-d #22A54E (readable), blue #2E68FF,
   violet #8A2BE2, ink #0A0B10/#050505, bg #F0F2F5, red #FF3366, amber #F0A431.
   Type: Plus Jakarta Sans everywhere — the system has no mono face. */
export const RC = {
  // surfaces
  // the tokens (docs/design.md), as strings an inline style can carry
  bg:      "var(--ground)",
  card:    "var(--paper)",
  card2:   "var(--tint)",
  ink:     "var(--ink)",
  inkDeep: "var(--ink)",
  ink2:    "var(--ink)",
  label:   "var(--q)",
  faint:   "var(--q)",
  line:    "var(--line)",
  lineStrong: "var(--line)",

  // install and service are told apart by their words, not a colour (ink and paper)
  install: "var(--ink)",
  installSoft: "var(--tint)",
  service: "var(--ink)",
  serviceSoft: "var(--tint)",
  teal:    "var(--ink)",
  amber:   "var(--warn)",
  amberSoft: "var(--warn-tint)",
  amberInk: "var(--warn-t)",
  amberDeep: "var(--warn-t)",
  red:     "var(--bad)",
  redSoft: "var(--bad-tint)",
  redInk:  "var(--bad-t)",
  violet:  "var(--ink)",
  violetSoft: "var(--tint)",

  head: "var(--font-jakarta), 'Plus Jakarta Sans', sans-serif",
  body: "var(--font-jakarta), 'Plus Jakarta Sans', sans-serif",
  r: 16,
} as const;
