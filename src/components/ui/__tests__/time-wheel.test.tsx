import { render, screen } from "@testing-library/react";
import { TimeWheel } from "../time-wheel";

/* THE CHOSEN TIME OPENS ON THE CENTRE LINE.

   A walk of the live timesheet on 2026-09-11 found every wheel opening one row
   low: 7:00 AM chosen, the highlight band on 8 · 05 · PM. The centring read
   `offsetTop`, which is measured from the nearest POSITIONED ancestor — and
   that is `.tw-cols` (positioned for the band), which also holds each column's
   label. The label's height went into the scroll distance; scroll-snapping
   hid it while the label was 9px, and the type scale's 12px label pushed it
   past half a row.

   jsdom has no layout, so the geometry is planted here as production measured
   it: a 22px label above each scroller, a 132px scroller with 49px of padding,
   34px rows. A value centres at its index × the row height. */

const LABEL = 22;
const PAD = 49;
const ROW = 34;
const VIEW = 132;

const KEYS = ["offsetTop", "offsetHeight", "offsetParent", "clientHeight", "scrollTop"] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
const scrolled = new WeakMap<Element, number>();

/** Plant the browser's geometry on the wheel's elements. `scrollerPositioned`
    is the other way the CSS could go: with `.tw-scroll` positioned, an option
    measures its `offsetTop` from the scroller itself. */
function plant(scrollerPositioned: boolean) {
  const proto = HTMLElement.prototype;
  for (const k of KEYS) saved.set(k, Object.getOwnPropertyDescriptor(proto, k));
  const isOpt = (el: HTMLElement) => el.classList.contains("tw-opt");
  const isScroller = (el: HTMLElement) => el.classList.contains("tw-scroll");
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isOpt(this) ? ROW : 0;
    },
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isScroller(this) ? VIEW : 0;
    },
  });
  Object.defineProperty(proto, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      if (isOpt(this)) return scrollerPositioned ? this.parentElement : this.closest(".tw-cols");
      if (isScroller(this)) return this.closest(".tw-cols");
      return null;
    },
  });
  Object.defineProperty(proto, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (isScroller(this)) return LABEL;
      if (!isOpt(this) || !this.parentElement) return 0;
      const i = Array.from(this.parentElement.children).indexOf(this);
      return (scrollerPositioned ? 0 : LABEL) + PAD + i * ROW;
    },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return scrolled.get(this) ?? 0;
    },
    set(this: HTMLElement, v: number) {
      scrolled.set(this, v);
    },
  });
}

afterEach(() => {
  const proto = HTMLElement.prototype;
  for (const k of KEYS) {
    const d = saved.get(k);
    if (d) Object.defineProperty(proto, k, d);
    else delete (proto as unknown as Record<string, unknown>)[k];
  }
  saved.clear();
});

const scroller = (column: "Hour" | "Minute" | "AM/PM") => screen.getByRole("listbox", { name: column });

it("opens with the chosen time on the centre line, not one row below it", () => {
  plant(false);
  render(<TimeWheel label="Start" value="7:00 AM" onChange={() => {}} />);
  expect(scroller("Hour").scrollTop).toBe(6 * ROW); // "7" is the seventh hour
  expect(scroller("Minute").scrollTop).toBe(0); // "00"
  expect(scroller("AM/PM").scrollTop).toBe(0); // "AM"
});

it("keeps a late value centred too, where the old error snapped a whole row on", () => {
  plant(false);
  render(<TimeWheel label="Finish" value="11:55 PM" onChange={() => {}} />);
  expect(scroller("Hour").scrollTop).toBe(10 * ROW);
  expect(scroller("Minute").scrollTop).toBe(11 * ROW);
  expect(scroller("AM/PM").scrollTop).toBe(1 * ROW);
});

/* The fix must not trade one ancestor for another: if the scroller is ever
   positioned itself, an option measures from it directly. */
it("centres the same way if the scroller itself is ever positioned", () => {
  plant(true);
  render(<TimeWheel label="Start" value="3:45 PM" onChange={() => {}} />);
  expect(scroller("Hour").scrollTop).toBe(2 * ROW);
  expect(scroller("Minute").scrollTop).toBe(9 * ROW);
  expect(scroller("AM/PM").scrollTop).toBe(1 * ROW);
});
