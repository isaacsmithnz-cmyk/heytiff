import fs from "node:fs";
import path from "node:path";

/* THE APPROVER'S LIST HAS TWO VERTICAL AXES, AND THEY ARE ARITHMETIC.

   Time & Pay draws a stack of people under a heading: some as the rich review
   card (`.card`), the rest as compact rows (`.crow`). Both are SURFACES, so
   both inset their contents by their own padding plus their own border — and
   the section heading above them (`.sect`) has to carry that same inset by
   hand, because it is not a surface and has nothing to inset it.

   Get any one of the three wrong and the screen staggers: before this test the
   values were 25 / 21 / 0, which put `Approve all` twenty-five pixels RIGHT of
   every `Approve` below it and every name four pixels off the name above it.
   Two spellings of one action, fifty pixels apart, on different edges.

   These are COMPUTATIONS, not pinned numbers. Change `.crow`'s padding, or
   either border, or either avatar, and the test re-checks the whole
   relationship rather than agreeing with whichever half moved. Nothing here
   asserts a value is 25 — only that the three agree.

   Sibling of text-contrast.test.ts, which reads the same sheet the same way. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

/** The declaration block of the FIRST rule whose selector starts with this. */
function block(selectorStart: string): string {
  const at = CSS.indexOf(selectorStart + " {");
  if (at < 0) throw new Error(`no rule "${selectorStart} {" in shell.css`);
  return CSS.slice(at, CSS.indexOf("}", at));
}

/** A plain px declaration — `gap:10px`, `width:46px`. */
function px(selectorStart: string, prop: string): number {
  const m = block(selectorStart).match(new RegExp(`(?:^|[;{] *)${prop}: *(-?[\\d.]+)px`));
  if (!m) throw new Error(`${prop} is not declared in px on "${selectorStart}"`);
  return parseFloat(m[1]!);
}

/** The horizontal half of a `padding:` shorthand (1, 2 or 4 values). */
function padX(selectorStart: string): number {
  const m = block(selectorStart).match(/(?:^|[;{] *)padding: *([^;]+)/);
  if (!m) throw new Error(`no padding shorthand on "${selectorStart}"`);
  const parts = m[1]!.trim().split(/\s+/).map((v) => parseFloat(v));
  // 1 value → all sides; 2 or 3 → the second is left/right; 4 → the fourth is left
  const side = parts.length === 1 ? parts[0]! : parts.length === 4 ? parts[3]! : parts[1]!;
  if (Number.isNaN(side)) throw new Error(`padding on "${selectorStart}" is not px`);
  return side;
}

/** The width out of a `border:` shorthand. */
function borderW(selectorStart: string): number {
  const m = block(selectorStart).match(/(?:^|[;{] *)border: *(-?[\d.]+)px/);
  if (!m) throw new Error(`no px border shorthand on "${selectorStart}"`);
  return parseFloat(m[1]!);
}

const SECT = ".fg .tpr .sect";
const CARD = ".fg .tpr .card";
const CROW = ".fg .tpr .crow";
const CHEAD = ".fg .tpr .chead";

describe("Time & Pay — the list's two axes", () => {
  /* The one every reader of the screen sees: the heading, both surfaces'
     contents and every action pill down the right stand on one pair of edges. */
  it("the section heading stands where its rows put their contents", () => {
    const reviewInset = padX(CARD) + borderW(CARD);
    const rowInset = padX(CROW) + borderW(CROW);

    expect(rowInset).toBe(reviewInset);
    expect(padX(SECT)).toBe(reviewInset);
  });

  /* Both ends of it: `Approve all` sits in `.sect`, `Approve`/`Send back` sit
     inside the surfaces, and the right edge is the same subtraction. */
  it("Approve all lands on the same right edge as every Approve below it", () => {
    const fromCardEdge = (inset: number) => inset; // both are measured from the card's content box
    expect(fromCardEdge(padX(SECT))).toBe(fromCardEdge(padX(CROW) + borderW(CROW)));
    expect(fromCardEdge(padX(SECT))).toBe(fromCardEdge(padX(CARD) + borderW(CARD)));
  });

  /* The second axis: a name is a name whichever surface it is on. The avatars
     are deliberately different sizes — the review card is the hero of the list
     — so the GAP carries the difference. */
  it("a name starts in the same place on both surfaces", () => {
    const review = px(`${CHEAD} .av`, "width") + px(CHEAD, "gap");
    const row = px(`${CROW} .av`, "width") + px(CROW, "gap");
    expect(review).toBe(row);
  });

  /* The legend is card furniture, not list furniture: it is a direct child of
     the card like the period row and the stat strip, so it takes no inset of
     its own. It carried `padding:0 2px` and put DAY COLOUR on its own edge. */
  it("the legend takes no inset of its own", () => {
    expect(() => padX(".fg .tpr .legend")).toThrow();
  });
});
