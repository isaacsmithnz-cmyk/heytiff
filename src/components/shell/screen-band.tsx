import type { ReactNode } from "react";

/* THE BAND ON A SCREEN WITH NO TABS (2026-09-20, the Workboard's frame
   everywhere — docs/design.md).

   A screen with tabs gets this row from ViewTabs, which takes the title as
   its `lead`. A screen without them — the Admin menu, the Noticeboard, the
   Toolbox — still wants the same row: the same height, the same 24px gutter,
   the same hairline under it, and the same right-hand end for whatever used
   to sit beside the title. That is all this is, so the two kinds of screen
   line up with each other and with the board.

   The way back, where a screen has one, keeps its own line above the band:
   it belongs to the screen you came from, not to this one. */
export function ScreenBand({
  title,
  tools,
  crumb,
}: {
  title: ReactNode;
  /** what stood beside the title — one button, a search field */
  tools?: ReactNode;
  /** the link back, on its own line above the band */
  crumb?: ReactNode;
}) {
  return (
    <>
      {crumb ? <div className="wb2-crumbline">{crumb}</div> : null}
      <div className="wb2-vtabs">
        <h1 className="wb2-h1">{title}</h1>
        {tools ? (
          <div className="wb2-vtcap">
            <div className="wb2-headtools">{tools}</div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** What the band sits on: the page's one surface, scrolling on its own.
    `pad` for content that was written against a card's inner padding and no
    longer has a card to take it from. */
export function ScreenPanel({ children, pad = true }: { children: ReactNode; pad?: boolean }) {
  return (
    <div className="wb2-card">
      <div className={pad ? "wb2-panel pad" : "wb2-panel"}>{children}</div>
    </div>
  );
}
