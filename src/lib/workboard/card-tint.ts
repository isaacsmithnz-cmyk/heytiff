/* The card band's colour wash, shared by every sheet that wears the job
   card's dress. Pure on purpose: the job sheet and the maintenance visit
   sheet both need it, and importing one sheet from the other would drag a
   card's server actions into every jsdom suite that renders the borrower —
   the `"use server"` import trap, hit twice already. */

/** The band's wash, crown and every echo of the card's colour, as CSS
    custom properties — the stylesheet holds the neutral fallbacks, so a card
    with no colour simply doesn't set these and the band stays grey.
    Category palettes (ServiceM8's or our own) make no contrast promise,
    which is why every alpha here is fixed and low: the colour is atmosphere,
    never the ground text has to survive on. */
export function catTintVars(colour: string | null | undefined): React.CSSProperties | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour ?? "");
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  const a = (alpha: number) => `rgba(${rgb},${alpha})`;
  return {
    "--jc-band-a": a(0.18),
    "--jc-band-b": a(0.1),
    "--jc-crown": a(0.55),
    "--jc-soft": a(0.35),
    "--jc-a05": a(0.05),
    "--jc-a025": a(0.025),
  } as React.CSSProperties;
}
