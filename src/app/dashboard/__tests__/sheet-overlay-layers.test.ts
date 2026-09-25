import fs from "node:fs";
import path from "node:path";

/* ── WHAT OPENS OVER A CARD SITS ON THE CARD'S LAYER ──

   The Workboard's sheets sit on the modal layer. Four things open over one,
   each a scrim and a surface: an invoice's own modal, the media viewer and
   the SWMS wizard inside the job card's portal, and the capture card in a
   portal of its own when a note field on a sheet hands over to it.

   When the layers were named (#683) the sheet went to the modal layer and
   the first three pairs it had then went to the overlay layer, so each
   opened invisibly UNDER the card it was opened from. The claim modal had
   done the same once before, at 61. MEASURED on a harness loading
   tokens.css and shell.css with the job card's markup from its tests: at the
   centre of the open claim, the viewer and the capture card, the element on
   top belonged to the sheet; with the pairs on the modal layer, to each pair.

   Two facts put a pair on top, and jsdom can see neither as a stacking
   context:
   - the LAYER, held here — the pair resolves to the sheet's own layer;
   - the ORDER, held in the job card's tests — at an equal z-index the later
     element paints on top, and the pair renders after the sheet.
   A stylesheet-text guard, like its neighbours. */

const read = (f: string) =>
  fs.readFileSync(path.join(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const TOKENS = read("src/app/tokens.css");
const CSS = ["src/app/dashboard/shell.css", "src/components/swms/swms.css"].map(read).join("\n");

/** The layer a selector's own rule puts it on, with the token resolved. Only a
    rule naming the selector alone counts — `.wb2-sheet.jc` is not `.wb2-sheet`. */
function layer(selector: string): number {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const set = [...CSS.matchAll(new RegExp(`(?:^|[{}])\\s*${esc}\\s*\\{([^}]*)\\}`, "g"))]
    .map((m) => /z-index\s*:\s*([^;}]+)/.exec(m[1])?.[1].trim())
    .filter((z): z is string => Boolean(z));
  if (set.length !== 1) throw new Error(`${selector}: ${set.length} rules set its z-index, expected 1`);
  const token = /^var\((--z-[a-z]+)\)$/.exec(set[0]);
  if (!token) throw new Error(`${selector}: z-index ${set[0]} is not one of the six layers`);
  const value = new RegExp(`${token[1]}\\s*:\\s*(-?\\d+)`).exec(TOKENS);
  if (!value) throw new Error(`${token[1]} is not declared in tokens.css`);
  return Number(value[1]);
}

const SHEET = layer(".wb2-sheet");

describe("what opens over a card sits on the card's layer", () => {
  it.each([
    [".wb2-clscrim", "the invoice's scrim"],
    [".wb2-claim", "the invoice"],
    [".wb2-mvscrim", "the viewer's scrim"],
    [".wb2-mv", "the viewer"],
    [".wb2-capdim", "the capture card's dim"],
    [".wb2-capcard", "the capture card"],
    [".swz-scrim", "the SWMS wizard's scrim"],
    [".swz", "the SWMS wizard"],
    [".tm-scrim", "the Tiff modal's scrim"],
    [".tm", "the Tiff modal"],
  ])("%s, %s, is on the sheet's layer", (selector) => {
    expect(layer(selector)).toBe(SHEET);
  });

  it("leaves the toasts above all of it", () => {
    expect(layer(".wb2-toasts")).toBeGreaterThan(SHEET);
  });
});
