/* Rate Calculator tokens — the HeyTiff system.
   Palette: teal #00E5C0 (accent), teal-d #22A54E (readable), blue #2E68FF,
   violet #8A2BE2, ink #0A0B10/#050505, bg #F0F2F5, red #FF3366, amber #F0A431.
   Type: Plus Jakarta Sans everywhere — the system has no mono face. */
export const RC = {
  // surfaces
  bg:      "#EDEFF4",             // light well inside the dark frame
  card:    "#FFFFFF",
  card2:   "#F4F5F7",             // subtle panel
  ink:     "#0A0B10",             // fg --ink2 (text ink)
  inkDeep: "#050505",             // fg --ink (dark surfaces)
  ink2:    "#374151",             // gray700 — secondary text
  label:   "#6b7280",             // gray500
  faint:   "#9ca3af",             // gray400 — tertiary text
  line:    "#eef0f3",             // hairline
  lineStrong: "#e5e7eb",

  // brand mapping — Install = HeyTiff blue, Service = readable teal
  install: "#2E68FF",
  installSoft: "#EAF0FF",
  service: "#22A54E",
  serviceSoft: "#E7F6EC",
  teal:    "#00E5C0",             // accent glow / dark-surface highlight
  amber:   "#F0A431",
  amberSoft: "#FCF3E3",
  amberInk: "#B45309",            // headings on amber
  amberDeep: "#7C5116",           // body text on amber
  red:     "#FF3366",
  redSoft: "#FFEBF0",
  redInk:  "#D61F53",
  violet:  "#8A2BE2",
  violetSoft: "#F3EBFC",

  head: "var(--font-jakarta), 'Plus Jakarta Sans', sans-serif",
  body: "var(--font-jakarta), 'Plus Jakarta Sans', sans-serif",
  r: 16,
} as const;
