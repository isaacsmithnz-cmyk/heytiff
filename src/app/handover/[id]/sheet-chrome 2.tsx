import type { ReactNode } from "react";
import type { OrgBrand } from "@/lib/org/brand";
import { themeVars } from "@/lib/org/theme";

/* THE HANDOVER SHEET'S CHROME — the business frame, the print machinery and
   the stylesheet, split out of the route so a harness can render the real
   thing without the auth gate or a project row. The route owns the CONTENT;
   this owns the paper it prints on.

   The construction is the design sheet's (summary/sheet-doc.css), copied
   deliberately rather than shared: one is a component stylesheet, this is a
   template literal riding inside a page, and a premature abstraction over
   that difference is how a backtick ends up inside a template. The numbers
   still exist once — everything here reads `--doc-*` from themeVars. */

const CSS = `
  /* THE BUSINESS FRAME — the same construction and the same numbers as the
     design sheet. One filled rectangle behind the sheet with a white well
     inset on ALL FOUR sides and rounded at the corners, which is
     '.fg .outlet' exactly. It carries nothing, so no contrast floor and no
     reversed artwork.

     NO COLOUR MEANS NO FRAME: themeVars returns nothing for a business that
     has chosen nothing, every fallback below is 0 or transparent, and the
     sheet is the plain document it always was.

     ON PAPER THE SAME TWO LAYERS GO FIXED, stamped by the print engine onto
     every page at full height — including the tail of a last page whose
     content stops early, the case no in-flow box can cover. Fixed boxes are
     clipped to the page box, which is why the page prints with NO margin at
     all: with margin 0 the page box IS the paper, and the frame sits at the
     inset the sheet draws for itself. Proved the hard way on the design sheet
     - see #481 and #539.

     Fixed paint does not displace content, and vertical padding does not
     repeat across page fragments, so the spacer table below holds the
     frame's room open on every page: thead and tfoot keep the band's height,
     the cell's side padding keeps the sides, and the well block's cloned
     padding keeps the clear. The spacers carry NO paint - a second copy of
     the ink would sit on top of the fixed well and notch against it. */
  /* CONCENTRIC WITH THE WELL: the well is inset by the gutter and rounded by
     the radius, so the outside is rounded by the two added or the frame runs
     thick at the corners and thin down the sides. Square, it reads as a block
     with a rounded hole cut in it.

     IT KEEPS ITS CORNERS ON PAPER TOO. The sheet used to bleed to the paper's
     edge and square the band off there, because a radius AT the paper's own
     corner draws four white notches. The band no longer reaches that corner -
     the print block insets it - so there is no notch to avoid and nothing to
     square. One shape on screen and on paper. */
  .ho-band { position: absolute; inset: 0;
    background: var(--doc-ink, transparent); pointer-events: none;
    border-radius: calc(var(--doc-radius, 0px) + var(--doc-gutter, 0px));
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ho-well { position: absolute; inset: var(--doc-gutter, 0px);
    background: var(--doc-well, transparent); border-radius: var(--doc-radius, 0px);
    pointer-events: none;
    /* this layer prints, and it is the white the page is carved back out of:
       dropped as a background economy, the whole page prints solid brand
       colour behind the text */
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ho-sheet { position: relative; min-height: 100vh; background: #fff; }
  /* scoped to the CONTENT: a '.ho-sheet > *' rule would also match the two
     layers above at equal specificity and strip their position:absolute */
  .ho-sheet > .ho-fr { position: relative; }

  /* the spacer table is NOT a table on screen - every part of it is a plain
     block, the head and foot are hidden, and the two layers above draw the
     frame; a scrolling document has no pages to close */
  .ho-fr,
  .ho-fr > thead,
  .ho-fr > tfoot,
  .ho-fr > tbody,
  .ho-fr > * > tr,
  .ho-fr > * > tr > td { display: block; width: auto; margin: 0; padding: 0; border: 0; background: none; }
  .ho-fr > thead,
  .ho-fr > tfoot { display: none; }

  .ho { max-width: 780px; margin: 0 auto; padding: var(--doc-pad, 40px) var(--doc-side, 28px) var(--doc-pad, 64px); color: #16181d;
    font-family: var(--font-jakarta, "Plus Jakarta Sans", sans-serif); font-size: 13.5px; line-height: 1.5; }
  .ho h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; margin: 2px 0 4px; }
  .ho h2 { font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    color: #6b7280; margin: 26px 0 8px; border-bottom: 2px solid #16181d; padding-bottom: 5px; }
  .ho-kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #6b7280; }
  .ho-sub { color: #4b5563; margin: 0; }
  .ho-meta { display: flex; gap: 26px; flex-wrap: wrap; margin-top: 14px; }
  .ho-meta div { min-width: 130px; }
  .ho-meta span { display: block; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #9ca3af; }
  .ho-meta b { font-size: 13px; }
  .ho table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  .ho th { text-align: left; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
    color: #6b7280; padding: 6px 8px 6px 0; border-bottom: 1px solid #d1d5db; }
  .ho td { padding: 7px 8px 7px 0; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .ho-two { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .ho ul { margin: 4px 0 0; padding-left: 18px; }
  .ho li { margin: 3px 0; }
  .ho-check { color: #00806b; font-weight: 800; }
  .ho-cross { color: #b31038; font-weight: 800; }
  .ho-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 30px; }
  .ho-sign div { border-top: 1.5px solid #16181d; padding-top: 6px; font-size: 11.5px; color: #4b5563; }
  .ho-print { position: fixed; top: 16px; right: 16px; border: 1px solid #d1d5db; background: #fff;
    border-radius: 10px; padding: 9px 14px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .ho-note { color: #6b7280; font-size: 12px; }
  /* The letterhead band. A rule under it rather than a box around it: this is
     the top of a document, and the sheet already has enough frames. */
  .ho-head { display: flex; align-items: flex-end; justify-content: space-between;
    gap: 24px; flex-wrap: wrap; padding-bottom: 14px; margin-bottom: 22px;
    border-bottom: 2px solid #16181d; }
  /* The letterhead is the part that gives, and the kicker is the part that
     does not: a long contact line wraps inside the letterhead rather than
     pushing "Handover sheet" onto a line of its own, where it would sit at
     the wrong end of the band with nothing to align against.

     The basis is 0 and not auto, which is the whole trick. The band wraps,
     and a flex item measured at auto is sized to its MAX-CONTENT before
     wrapping is decided — so a long business name plus a full contact line
     was taken as one unbreakable lump and pushed onto its own line. At a zero
     basis the two always share the line, and min-width:0 is what lets the
     contact wrap inside the letterhead instead. */
  .ho-head .org-lh { flex: 1 1 0; min-width: 0; }
  .ho-head .ho-kicker { flex: 0 0 auto; text-align: right; }
  .ho-foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e5e7eb; }
  @media print {
    .ho-print { display: none; }
    /* the band must not be orphaned at the foot of a page from its own sheet,
       a section heading must not be orphaned from its section, and a table
       row or the sign-off pair must not be cut through the middle */
    .ho-head { break-after: avoid; }
    .ho h2 { break-after: avoid; }
    .ho tr { break-inside: avoid; }
    .ho-sign { break-inside: avoid; }
    /* and the installer's line never gets a page to itself. It is one line of
       12px type, so it is easy to push over a break - and what that prints is
       an otherwise empty framed sheet with "Installed by ..." at the top of
       it. Seen in the harness on a four-row sheet. */
    .ho-foot { break-before: avoid; }
    .ho { padding: 0; max-width: none; }
    .ho-sheet { min-height: 0; }

    /* THE SHEET DRAWS ITS OWN PAPER MARGIN, and the page box has none.

       Two things fall out of one decision, the same pair the design sheet
       made in #539:

       1. a browser prints its own furniture - the date, the tab title, the
          page URL, the page number - INTO the page margin and nowhere else.
          With no margin there is nowhere to put it, so a sheet a customer
          keeps carries the business's letterhead and nothing of ours.
       2. a fixed box is clipped to the page box, so inside a browser margin
          the frame cannot reach the paper at all.

       What replaces it is this inset. The frame is drawn AT it, so the band
       is a rounded rectangle sitting on the paper rather than one bled to the
       paper's corners and squared off there - which is what the sheet used to
       print, and what Isaac asked to be rid of.

       10mm, and the SAME 10mm the design sheet uses (--dsd-edge): these are
       both the business's documents, they share every other number through
       --doc-*, and a band sitting 10mm in on one and 16mm in on the other is
       a difference nobody chose. It cannot come from themeVars with the rest
       of the geometry, because themeVars ships nothing at all for a business
       that has chosen no colour and this margin has to hold either way.

       It is not the 16mm the unthemed sheet used to get from @page. That was
       the whole page margin; this is the paper margin PLUS, for a themed
       sheet, the band and its clear on top - 20mm, against the 16mm the
       themed sheet used to bleed to. Bigger than 10 was tried at 16 and cost
       26mm a side, which tipped a one-page sheet onto two. */
    .ho-sheet { --ho-edge: 10mm; }
    @page { margin: 0; }

    /* the layers stamp the frame onto every page; the table holds its room */
    .ho-band, .ho-well { position: fixed; }
    .ho-band { inset: var(--ho-edge); }
    .ho-well { inset: calc(var(--ho-edge) + var(--doc-gutter, 0px)); }
    .ho-fr { display: table; width: 100%; border-collapse: collapse; }
    .ho-fr > thead { display: table-header-group; }
    .ho-fr > tfoot { display: table-footer-group; }
    .ho-fr > tbody { display: table-row-group; }
    .ho-fr > * > tr { display: table-row; }
    .ho-fr > * > tr > td { display: table-cell; }
    /* anchored to the row groups: the screen reset above is (0,1,2) and
       '@media print' adds no specificity, so anything lighter loses to it
       silently - the design sheet shipped that bug once already */
    .ho-fr > thead > tr > td.ho-fr-t,
    .ho-fr > tfoot > tr > td.ho-fr-b { height: calc(var(--ho-edge) + var(--doc-gutter, 0px)); }
    .ho-fr > tbody > tr > td.ho-fr-c { padding: 0 calc(var(--ho-edge) + var(--doc-gutter, 0px)); vertical-align: top; }
    /* the clear, cloned onto every page fragment so content clears the band
       at the top and foot of every page, not only the document's true ends.

       ONE clear, not two. It was doubled because the frame WAS the page
       margin - bled to the paper, so text 10mm in read as a compliment slip.
       The inset above is that margin now, and doubling it as well would spend
       it twice: 10 + 4 + 12 is 26mm a side on a sheet whose tables want the
       width.

       AND IT FALLS BACK TO A REAL VALUE, which looks like the #470 trap and
       is its opposite. That trap is room made for a band that did not render.
       This padding is no longer the band's clear - since @page lost its
       margin it is the DOCUMENT'S OWN inset from the paper, which an unthemed
       sheet needs exactly as much as a themed one. 6mm keeps the plain sheet
       at the 16mm it has always printed with; without it the fallback is 0
       and a business that has chosen no colour gets its text 10mm from the
       edge of the page. */
    .ho-fr > tbody > tr > td.ho-fr-c > .ho-fr-w {
      padding: var(--doc-clear, 6mm);
      box-decoration-break: clone;
    }
  }
`;

/** The paper the handover content prints on: the theme variables, the frame
    layers, the print machinery and the sheet's own stylesheet. The route
    hands this its content; a harness can hand it anything. */
export function HandoverChrome({
  brand,
  children,
}: {
  brand: OrgBrand;
  children: ReactNode;
}) {
  return (
    <div className="ho-sheet" style={themeVars(brand.color)}>
      {/* ONE STYLESHEET NOW, AND NO BRAND BRANCH IN IT. There was a second,
          conditional <style> here that stripped the page margin and squared
          the band off for a themed sheet — the pair a full-bleed frame needs,
          and the reason an @page rule that cannot read a CSS variable had to
          be written from the component. Nothing bleeds any more: the margin
          comes off for EVERY sheet (it is where a browser prints its own
          date and URL) and the frame is inset in CSS, which a stylesheet can
          say perfectly well on its own. */}
      <style>{CSS}</style>
      {/* THE BUSINESS'S FRAME. Carries nothing and is announced to nobody: it
          is decoration, and a screen reader reading out a coloured rectangle
          would be reading out something that is not there. */}
      <div className="ho-band" aria-hidden="true" />
      <div className="ho-well" aria-hidden="true" />
      {/* the spacer table - a table only on paper; see the stylesheet */}
      <table className="ho-fr" role="presentation">
        <thead>
          <tr>
            <td className="ho-fr-t" />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td className="ho-fr-b" />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="ho-fr-c">
              <div className="ho-fr-w">
                <main className="ho">{children}</main>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
