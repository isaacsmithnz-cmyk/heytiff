import { jobPageHref } from "@/lib/shell/links";
import type { JobsListRow } from "./jobs-list";

/* THE JOBS LIST ON THE WIRE (Isaac, 25 October 2026: "trim the row data the
   Jobs page sends for filtering"). The page sends every job's row, all 971,
   so the views, Who, Sort and the search can work on them in the browser;
   as named objects that was 468 KB, a third of it the seventeen field
   names said 971 times over, and 59 KB a link the browser can rebuild from
   the job's own key. A row goes as a list in a fixed order instead, its
   link only where it isn't the job's page, and the browser unpacks it into
   the same row, so nothing that reads a row changes. */

/** The fields of a row on the wire, in order. */
const FIELDS = [
  "key",
  "number",
  "numberOurs",
  "client",
  "site",
  "kind",
  "hue",
  "state",
  "tone",
  "next",
  "on",
  "ahead",
  "who",
  "valueCents",
  "views",
  "words",
] as const satisfies readonly (keyof JobsListRow)[];

/** A row on the wire: its fields in FIELDS' order, then its link where the
    browser can't rebuild it. */
export type PackedRow = unknown[];

const SM8 = "sm8:";
/** The link a row has when nothing says otherwise: a ServiceM8 job's page. */
const ownHref = (key: string): string | null => (key.startsWith(SM8) ? jobPageHref(key.slice(SM8.length)) : null);

export function packRows(rows: readonly JobsListRow[]): PackedRow[] {
  return rows.map((r) => {
    const out: unknown[] = FIELDS.map((f) => r[f]);
    if (r.href !== ownHref(r.key)) out.push(r.href);
    return out;
  });
}

export function unpackRows(rows: readonly PackedRow[]): JobsListRow[] {
  return rows.map((p) => {
    const row = Object.fromEntries(FIELDS.map((f, i) => [f, p[i]])) as Omit<JobsListRow, "href">;
    /* packRows sends the link of every row that isn't a ServiceM8 job's page */
    const href = (p.length > FIELDS.length ? p[FIELDS.length] : ownHref(row.key)) as string;
    return { ...row, href };
  });
}
