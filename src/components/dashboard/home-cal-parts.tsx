import type { CalCat, CalItem } from "@/lib/calendar/items";

/* THE CALENDAR'S SMALL PARTS, shared by its views, its rail and its
   filters (./home-cal-page).

   A category's colour is never written in the markup: the element says
   which category it is (`data-c`) and the sheet's tokens on `.hd-cal` paint
   it (docs/design.md, Named exemptions: his calendar colours). */

/** Where a thing is picked from: a pointer, or a key (law 8: nothing moves
    for a key). */
export type Pick = (id: string, pointer: boolean) => void;

/** A view, a step or a pick fades in on `--t-fast`. */
export const CAL_FADE_MS = 120;

/** His swatch: a small sharp square in the category's colour (a key on a
    drawing has corners), the school holidays' hatch, the late red on
    admin past its date, or a dot where the rail lists what is due. */
export function CalSwatch({ cat, late = false, round = false }: { cat: CalCat; late?: boolean; round?: boolean }) {
  return (
    <i
      className="hd-cal-sw"
      data-c={cat}
      data-late={late ? "" : undefined}
      data-round={round ? "" : undefined}
      aria-hidden="true"
    />
  );
}

/** The link an item's action opens, or null: an event's Edit comes with
    the calendar's edit form, not before it. */
export function actionLink(x: CalItem): { label: string; href: string } | null {
  return x.action && x.action !== "edit" ? x.action : null;
}

/* What a press on a row must leave alone: anything that is its own
   control. */
export const OWN_CONTROL = "a, button, input, select, textarea";

/** Brings a chosen thing into its own scroller's view, near the top, when
    it is out of it. Only the view's own scroller moves: never the page. */
export function revealIn(el: Element | null | undefined) {
  const sc = el?.closest<HTMLElement>("[data-scroll]");
  if (!el || !sc) return;
  const r = el.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  if (r.top < s.top + 8 || r.bottom > s.bottom - 8) sc.scrollTop += r.top - s.top - 96;
}
