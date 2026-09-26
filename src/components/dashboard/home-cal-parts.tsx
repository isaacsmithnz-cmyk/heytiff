import type { CalCat, CalItem } from "@/lib/calendar/items";

/* THE CALENDAR'S SMALL PARTS, shared by its views, its rail and its
   filters (./home-cal-page).

   A category's colour is never written in the markup: the element says
   which category it is (`data-c`) and the sheet's tokens on `.hd-cal` paint
   it (docs/design.md, Named exemptions: his calendar colours). */

/** Where a thing is picked from: a pointer, or a key (law 8: nothing moves
    for a key). */
export type Pick = (id: string, pointer: boolean) => void;

/* HIS MOTION, as the prototype he walked moves it (calSwap, calPick,
   calChip and calLand), for a pointer only and never under reduced motion
   (law 8); a named exemption from law 18's two tokens (docs/design.md). What
   leaves fades out on `--t-fast`; what comes in fades in over his 180 ms,
   a view and the panel rising his 4px into place, a filter's things where
   they stand; and what Save lands grows in over his 280 ms and stays lit
   for his 2.4 s (`hdCalFresh`, shell.css). */
export const CAL_OUT_MS = 120;
export const CAL_IN_MS = 180;
export const CAL_RISE_PX = 4;
export const CAL_GROW_MS = 280;
export const CAL_FRESH_MS = 2400;

/** Fades out and holds there, until whoever started it takes it off. */
export function fadeOut(el: Element): Animation {
  return el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CAL_OUT_MS, easing: "ease-out", fill: "forwards" });
}

/** Fades in from `rise` px below. */
export function fadeIn(el: Element, rise: number): Animation {
  return el.animate(
    [
      { opacity: 0, transform: `translateY(${rise}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: CAL_IN_MS, easing: "ease-out", fill: "backwards" },
  );
}

/** Grows a row in from nothing to its own box (his expand): the rows under
    it give way as it grows, and it fades in as it goes. */
export function growIn(el: HTMLElement): Animation {
  const box = getComputedStyle(el);
  el.style.overflow = "hidden";
  const a = el.animate(
    [
      { height: "0px", marginTop: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 },
      {
        height: box.height,
        marginTop: box.marginTop,
        paddingTop: box.paddingTop,
        paddingBottom: box.paddingBottom,
        opacity: 1,
      },
    ],
    { duration: CAL_GROW_MS, easing: "ease-out", fill: "backwards" },
  );
  const done = () => {
    el.style.overflow = "";
  };
  a.finished.then(done, done);
  return a;
}

/* The things a filter fades: a row, an item, a bar, a span tag or a rail
   row of its category — never the panel, which shows the choice as it
   lands. */
const THINGS = ".hd-cal-it, .hd-cal-mi, .hd-cal-bar, .hd-cal-tag, .hd-ls-it";

export function thingsOf(root: Element | null | undefined, cat: CalCat): Element[] {
  if (!root) return [];
  const out = new Set<Element>();
  for (const el of root.querySelectorAll(`[data-c="${cat}"]`)) {
    if (el.closest(".hd-cal-det")) continue;
    out.add(el.closest(THINGS) ?? el);
  }
  return [...out];
}

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
