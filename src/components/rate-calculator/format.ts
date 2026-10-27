/* Display formatters — the UI never calculates, it only formats engine output. */

export const money = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString();

export const rate0 = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + Math.round(n);

/** The price with GST, from the whole-dollar rate that's shown beside it,
    so "$132 an hour" reads "$145.20 with GST" and never "$145.31". */
export const gstOf = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + (Math.round(n) * 1.1).toFixed(2);

/** Normalise a utilisation figure to the 0–100 range regardless of source scale. */
export const normUtil = (v: number | null | undefined): number =>
  v == null ? 0 : v > 100 ? v / 100 : v <= 1 ? v * 100 : v;

/** "a", "a and b", "a, b and c". */
export const listed = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
