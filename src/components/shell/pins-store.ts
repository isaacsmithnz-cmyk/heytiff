/* The sidebar's Pinned, in the browser (rule 6; lib/pins/pins.ts).

   The server hands the sidebar the list once, with the frame; after that a
   pin or an unpin shows at once and is written behind, and goes back if the
   write fails. One small store, so the sidebar and every record's Pin
   button read the same list without a round trip between them. */

import { PIN_MAX, pinKey, type Pin } from "@/lib/pins/pins";
import type { RecordRef } from "@/lib/records/ref";

let pins: readonly Pin[] = [];
/* Once you pin or unpin here, this page's list is the truer one: a server
   list drawn before the write landed must not take it back. */
let touched = false;
const listeners = new Set<() => void>();

function set(next: readonly Pin[]) {
  pins = next;
  for (const l of listeners) l();
}

export function subscribePins(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const pinsSnapshot = (): readonly Pin[] => pins;
const NONE: readonly Pin[] = [];
export const pinsServerSnapshot = (): readonly Pin[] => NONE;

/** The server's list, which stands until something is pinned or unpinned here. */
export function seedPins(list: readonly Pin[]): void {
  if (!touched) pins = list;
}

export const isPinned = (list: readonly Pin[], ref: RecordRef) => list.some((p) => pinKey(p.ref) === pinKey(ref));

/** Pin it at the top. Resolves false, and puts the list back, if the write fails. */
export async function pin(p: Pin): Promise<boolean> {
  touched = true;
  const before = pins;
  set([p, ...before.filter((q) => pinKey(q.ref) !== pinKey(p.ref))].slice(0, PIN_MAX));
  const ok = await fetch("/api/pins", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!ok) set(before);
  return ok;
}

/** Let it go. Resolves false, and puts it back, if the write fails. */
export async function unpin(ref: RecordRef): Promise<boolean> {
  touched = true;
  const before = pins;
  set(before.filter((q) => pinKey(q.ref) !== pinKey(ref)));
  const ok = await fetch("/api/pins", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(ref) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!ok) set(before);
  return ok;
}
