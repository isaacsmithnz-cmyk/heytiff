/* Display formatters — the UI never calculates, it only formats engine output. */

export const money = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString();

export const rate0 = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + Math.round(n);

export const gstOf = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + (n * 1.1).toFixed(2);

/** Normalise a utilisation figure to the 0–100 range regardless of source scale. */
export const normUtil = (v: number | null | undefined): number =>
  v == null ? 0 : v > 100 ? v / 100 : v <= 1 ? v * 100 : v;
