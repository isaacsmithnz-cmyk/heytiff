import { addDays, daysBetween } from "./period";

/* Unavailability — a casual saying which days they can't work.

   THIS IS A DECLARATION, NOT A REQUEST, and that distinction is the whole
   design. Leave is a request because it spends an entitlement and somebody has
   to agree to it. A casual has no entitlement to spend: they are offered work
   and they take it or they don't, so an approve/decline step over "I can't do
   Thursday" would be theatre — it implies the answer could be no, and it can't.

   So there is no status, no reviewer and no approval queue. A block goes up,
   whoever rosters can see it, and the casual can take it down again. The only
   rule is that it points forward: marking yourself unavailable for a day that
   has already passed says nothing about anything.

   It is deliberately NOT stored in leave_requests. Sharing that table would
   put rows with no balance, no status and no reviewer into the queries that
   compute what someone has left — and one forgotten filter would have an
   unavailability block eating a real leave balance. */

export type Unavailability = {
  id: string;
  staffId: string;
  staffName?: string;
  /** ISO, inclusive */
  from: string;
  /** ISO, inclusive — equals `from` for a single day */
  to: string;
  note?: string;
};

/** Every calendar day a block covers. */
export function blockDates(b: { from: string; to: string }): string[] {
  const out: string[] = [];
  for (let i = 0; i <= daysBetween(b.from, b.to); i++) out.push(addDays(b.from, i));
  return out;
}

/** Date → the block covering it, for marking up a week. */
export function blockedDays(blocks: Unavailability[]): Map<string, Unavailability> {
  const out = new Map<string, Unavailability>();
  for (const b of blocks) for (const d of blockDates(b)) out.set(d, b);
  return out;
}

/** Blocks that still say something — today's and later. A block that has run
    out is history, not a standing statement about availability. */
export function upcoming(blocks: Unavailability[], todayISO: string): Unavailability[] {
  return blocks.filter((b) => b.to >= todayISO).sort((a, b) => a.from.localeCompare(b.from));
}

/** How a block reads in a list: "Thu 2 Jul" or "2 – 5 Jul". */
export function blockLabel(b: { from: string; to: string }): string {
  const d = (iso: string) => Number(iso.slice(8, 10));
  const mon = (iso: string) =>
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
      Number(iso.slice(5, 7)) - 1
    ];
  if (b.from === b.to) return `${d(b.from)} ${mon(b.from)}`;
  return mon(b.from) === mon(b.to)
    ? `${d(b.from)} – ${d(b.to)} ${mon(b.to)}`
    : `${d(b.from)} ${mon(b.from)} – ${d(b.to)} ${mon(b.to)}`;
}

/** Is this range sayable? Backwards ranges and past dates are refused — the
    point of the feature is to tell someone something before they roster you. */
export function validateBlock(
  from: string,
  to: string,
  todayISO: string,
): { ok: true } | { ok: false; error: string } {
  if (!from || !to) return { ok: false, error: "Pick the days you can't work." };
  if (to < from) return { ok: false, error: "The last day can't be before the first." };
  if (to < todayISO)
    return { ok: false, error: "That's in the past — marking it now won't tell anyone anything." };
  if (daysBetween(from, to) > 365)
    return { ok: false, error: "Mark up to a year at a time." };
  return { ok: true };
}
