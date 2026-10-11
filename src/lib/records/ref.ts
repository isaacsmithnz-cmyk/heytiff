/* WHAT A DOOR ASKS THE RECORD HOST FOR, and how it rides in the address.

   One shape for every door into a record — ⌘K, Tiff, the bell, a chip, a
   link on any screen — so they all open the same window the same way. The
   host (components/records/record-host) is mounted once in the dashboard
   layout, above the outlet, so a record opens OVER the screen you are on
   instead of sending you to the Workboard and throwing that screen away.

   Pure: no React, no server. The tokens and the link reading are tested on
   their own. */

import type { JobSheetTab } from "@/components/workboard/board/job-sheet";

/** The kinds of record the host can open. Jobs first; the others join as
    each gets a loader that does not need its board on screen. */
export type RecordKind = "job";

/** A record, by its own id. A job's id is its ServiceM8 uuid. */
export type RecordRef = { kind: "job"; id: string };

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

/** `job.<uuid>`: the record's kind, a dot, its id. A uuid has no dot in it,
    so the first dot is the only one that splits. */
export function encodeRecord(ref: RecordRef): string {
  return `${ref.kind}.${ref.id}`;
}

export function decodeRecord(token: string | null | undefined): RecordRef | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const kind = token.slice(0, dot);
  const id = token.slice(dot + 1).trim();
  if (kind !== "job" || !id || id.length > MAX_ID || /[\s/?#&]/.test(id)) return null;
  return { kind, id };
}

/** The key a window is known by: one window per record. */
export const recordKey = (ref: RecordRef) => encodeRecord(ref);

/** What a link to a record names: the record, and the face it asked for.
    Only an address that is nothing but a record link counts — a Workboard
    link that also searches, or names a visit, is a screen, not a record. */
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

/** The record the address names, if any. */
export function openParamOf(href: string): RecordRef | null {
  try {
    return decodeRecord(new URL(href).searchParams.get(OPEN_PARAM));
  } catch {
    return null;
  }
}
