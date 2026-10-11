/* WHAT A DOOR ASKS THE RECORD HOST FOR, and how it rides in the address.

   One shape for every door into a record — ⌘K, Tiff, the bell, a chip, a
   link on any screen — so they all open the same window the same way. The
   host (components/records/record-host) is mounted once in the dashboard
   layout, above the outlet, so a record opens OVER the screen you are on
   instead of sending you to the Workboard and throwing that screen away.

   Pure: no React, no server. The tokens and the link reading are tested on
   their own. */

import type { JobSheetTab } from "@/components/workboard/board/job-sheet";
import { jobHref, visitHref } from "@/lib/shell/links";

/** The kinds of record the host can open: a job, and the two maintenance
    records that have no page of their own — a visit and the service
    agreement behind it. A project has its own page, which is its window. */
export type RecordKind = "job" | "visit" | "agreement";

const KINDS: readonly RecordKind[] = ["job", "visit", "agreement"];

/** A record, by its own id. A job's id is its ServiceM8 uuid; a visit's and
    an agreement's are ours. */
export type RecordRef = { kind: RecordKind; id: string };

/** The faces a job window may open on from a link (`&face=`). */
const JOB_FACES: readonly JobSheetTab[] = [
  "summary",
  "diary",
  "money",
  "photos",
  "documents",
  "compliance",
  "quote",
  "visits",
  "checklist",
] as const;

/** The query parameter the open record rides in. */
export const OPEN_PARAM = "open";

/** The longest id a token may carry. A ServiceM8 uuid is 36. */
const MAX_ID = 80;

/** `job.<uuid>`: the record's kind, a dot, its id. An id has no dot in it,
    so the first dot is the only one that splits. */
export function encodeRecord(ref: RecordRef): string {
  return `${ref.kind}.${ref.id}`;
}

export function decodeRecord(token: string | null | undefined): RecordRef | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const kind = token.slice(0, dot) as RecordKind;
  const id = token.slice(dot + 1).trim();
  if (!KINDS.includes(kind) || !id || id.length > MAX_ID || /[\s/?#&]/.test(id)) return null;
  return { kind, id };
}

/** The key a window is known by: one window per record. */
export const recordKey = (ref: RecordRef) => encodeRecord(ref);

/** What a link to a record names: the record, and the face it asked for.
    Only an address that is nothing but a record link counts — a Workboard
    link that also searches, or sits on a side, is a screen, not a record. A
    job's link is `?job=` (with its `&face=`), a visit's `?visit=`. */
export type RecordLinkTarget = { ref: RecordRef; face?: JobSheetTab };

export function recordOfHref(href: string): RecordLinkTarget | null {
  let url: URL;
  try {
    url = new URL(href, "https://heytiff.invalid");
  } catch {
    return null;
  }
  if (url.pathname !== "/dashboard/workboard") return null;
  const params = [...url.searchParams.keys()];
  const visit = url.searchParams.get("visit");
  if (visit !== null) {
    if (params.length !== 1) return null;
    const ref = decodeRecord(`visit.${visit}`);
    return ref ? { ref } : null;
  }
  const job = url.searchParams.get("job");
  if (!job || params.some((k) => k !== "job" && k !== "face")) return null;
  const ref = decodeRecord(`job.${job}`);
  if (!ref) return null;
  const face = url.searchParams.get("face");
  return face && (JOB_FACES as readonly string[]).includes(face) ? { ref, face: face as JobSheetTab } : { ref };
}

/** The address with the open record set, or taken out (null). Everything
    else in the address is kept as it was. */
export function withOpenParam(href: string, ref: RecordRef | null): string {
  const url = new URL(href);
  if (ref) url.searchParams.set(OPEN_PARAM, encodeRecord(ref));
  else url.searchParams.delete(OPEN_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The record's own address, to send someone: a job's and a visit's are
    the Workboard's links to them; an agreement, which has none, opens over
    the Workboard by the open record's own parameter. */
export function recordHref(ref: RecordRef): string {
  if (ref.kind === "job") return jobHref(ref.id);
  if (ref.kind === "visit") return visitHref(ref.id);
  return `/dashboard/workboard?${OPEN_PARAM}=${encodeURIComponent(encodeRecord(ref))}`;
}

/** The record the address names, if any. */
export function openParamOf(href: string): RecordRef | null {
  try {
    return decodeRecord(new URL(href).searchParams.get(OPEN_PARAM));
  } catch {
    return null;
  }
}
