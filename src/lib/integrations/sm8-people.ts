/* ServiceM8's people, mapped to the shared import shape. Shaping only —
   arranging is people-import.ts's job, and the accept rule is enforced by the
   action that writes.

   Email and mobile appear here (the live staff.json read) and are persisted
   only onto cards a human chooses to create; the sm8_staff MIRROR stays
   names-and-titles, its PII posture untouched and test-enforced. */

import type { ImportCandidate } from "./people-import";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const orNull = (v: unknown): string | null => str(v) || null;

/** One raw staff.json row → the shared shape, or null when it can't be shown
    or linked. Same two drops as Xero's shapeEmployee, for the same reasons:
    no uuid means nothing to store in remote_id, no name means an unusable
    row in every picker it would appear in. */
export function shapeSm8Person(raw: unknown): ImportCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = str(r.uuid);
  if (!id) return null;

  const first = orNull(r.first);
  const last = orNull(r.last);
  const name = [first, last].filter(Boolean).join(" ");
  if (!name) return null;

  return {
    id,
    first,
    last,
    name,
    jobTitle: orNull(r.job_title),
    email: orNull(r.email),
    phone: orNull(r.mobile),
    // ServiceM8 sends active as 1/0; anything unreadable counts as inactive
    // rather than surfacing a ghost as an importable person.
    active: r.active === 1 || r.active === "1",
  };
}
