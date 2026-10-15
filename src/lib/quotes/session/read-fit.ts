/* A read of the quote that fits what a tool can hand her. A tool's answer is
   cut at 20,000 characters, and a read cut there is JSON stopped mid-line:
   on the bench (15 October) 2043's 175 lines stopped partway through option
   1, so she built on, and wrote back, a quote she couldn't see the half of.
   A read too long is narrowed instead, each step saying what it left out:
   one option's lines (every option's total and what's still to price stay),
   then that option's lines without the empty fields and with each why
   shortened, then those lines a page at a time. */

/** One option as read_quote gives it: its lines with whatever else it carries. */
export type OptionRead = { option: number; lines: Record<string, unknown>[] } & Record<string, unknown>;

/** Under the tool's 20,000, for the wrapping the result is sent in. */
export const READ_BUDGET = 18_000;
const WHY = 80;

const size = (v: unknown) => JSON.stringify(v).length;

/** A line without its empty fields, its why cut to a phrase. */
function compact(line: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(line)) {
    if (v == null || v === "") continue;
    out[k] = k === "why" && typeof v === "string" && v.length > WHY ? `${v.slice(0, WHY - 1)}…` : v;
  }
  return out;
}

/** The read as it is when it fits; else narrowed to `ask.option` (the first
    when none is asked), then compacted, then paged from `ask.from`. */
export function fitRead(options: OptionRead[], ask: { option?: number | null; from?: number | null } = {}, budget = READ_BUDGET): Record<string, unknown>[] {
  if (ask.option == null && size(options) <= budget) return options;
  const at = Math.max(0, options.findIndex((o) => o.option === (ask.option ?? 0)));
  const head = (o: OptionRead): Record<string, unknown> => {
    const { lines, ...rest } = o;
    return { ...rest, lines_not_shown: lines.length, read_with: { option: o.option } };
  };
  const shaped = (one: Record<string, unknown>) => options.map((o, i) => (i === at ? one : head(o)));
  const asked = options[at]!;

  const whole = shaped(asked);
  if (size(whole) <= budget) return whole;
  const lines = asked.lines.map(compact);
  const short = shaped({ ...asked, lines, whys_shortened: true });
  if (size(short) <= budget) return short;

  /* a page of lines from `from`, as many as fit */
  const from = Math.min(Math.max(0, Math.floor(ask.from ?? 0)), lines.length);
  const page = (to: number) =>
    shaped({ ...asked, lines: lines.slice(from, to), whys_shortened: true, lines_shown: `${from + 1}–${to} of ${lines.length}`, ...(to < lines.length ? { read_more_from: to } : {}) });
  let to = Math.min(from + 1, lines.length);
  while (to < lines.length && size(page(to + 1)) <= budget) to++;
  return page(to);
}
