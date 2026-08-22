import type { ReactNode } from "react";
import type { OrgBrand } from "@/lib/org/brand";
import { documentTheme, themeVars } from "@/lib/org/theme";

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
     clipped to the page box, which is why this only works because a themed
     page prints with NO margin (the conditional @page rule the chrome
     injects): with margin 0 the page box IS the paper. Proved the hard way
     on the design sheet - see #481.

     Fixed paint does not displace content, and vertical padding does not
     repeat across page fragments, so the spacer table below holds the
     frame's room open on every page: thead and tfoot keep the band's height,
     the cell's side padding keeps the sides, and the well block's cloned
     padding keeps the clear. The spacers carry NO paint - a second copy of
     the ink would sit on top of the fixed well and notch against it. */
  /* CONCENTRIC WITH THE WELL: the well is inset by the gutter and rounded by
     the radius, so the outside is rounded by the two added or the frame runs
     thick at the corners and thin down the sides. Square, it reads as a block
     with a rounded hole cut in it. A full-bleed print squares it off again -
     see the themed style the component injects. */
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
    .ho { padding: 0; max-width: none; }
    .ho-sheet { min-height: 0; }

    /* the layers stamp the frame onto every page; the table holds its room */
    .ho-band, .ho-well { position: fixed; }
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
    .ho-fr > tfoot > tr > td.ho-fr-b { height: var(--doc-gutter, 0px); }
    .ho-fr > tbody > tr > td.ho-fr-c { padding: 0 var(--doc-gutter, 0px); vertical-align: top; }
    /* the clear, cloned onto every page fragment so content clears the band
       at the top and foot of every page, not only the document's true ends */
    .ho-fr > tbody > tr > td.ho-fr-c > .ho-fr-w {
      padding: calc(var(--doc-clear, 0px) * 2);
      box-decoration-break: clone;
    }
    /* the unthemed sheet's page margin. The themed sheet overrides this to 0
       from the chrome component - an @page rule cannot read a CSS variable,
       so the condition has to live where the brand does. */
    @page { margin: 16mm; }
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
  /* the same gate the frame itself uses: a colour the derivation refuses is
     no theme, and a margin removed for a frame that is not there would print
     the plain sheet flush against the paper's edge */
  const themed = brand.color != null && documentTheme(brand.color) != null;
  return (
    <div className="ho-sheet" style={themeVars(brand.color)}>
      <style>{CSS}</style>
      {/* A THEMED PRINT OWNS THE PAPER EDGE. Fixed boxes are clipped to the
          page box; only with no margin is the page box the paper, so the
          frame can reach it. Unthemed keeps the 16mm in the sheet above. */}
      {themed && (
        <style>
          {"@media print { @page { margin: 0; } .ho-band { border-radius: 0; } }"}
        </style>
      )}
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
