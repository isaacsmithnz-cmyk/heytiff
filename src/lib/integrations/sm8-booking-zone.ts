/* The ServiceM8 account's time zone, for booking — server only (two-way
   phase 3, PR B).

   A booking's start and end are the account's wall clock as text (P1 read
   one booked by hand back as exactly the time chosen), so every booking is
   pressed, queued and sent in ONE zone: the account's own, as the sync
   last read it from vendor.json into sm8_vendor.timezone_name
   (sm8.ts). It is in PR B because the sender needs it before any request;
   PR C's live reads re-export it.

   THERE IS NO FALLBACK. todayInZone falls back to Sydney (dates.ts); a
   booking never does. A zone HeyTiff doesn't know — none synced yet, or one
   Intl can't read — books nothing: the press is refused, and a row waiting
   to go waits. A database read that fails says so apart (`unread`), so a
   blip is never mistaken for an account with no zone.

   The connection's own tenants[0].timezoneName (readSm8WriteState's
   timezoneName) stays for the daily limit's reset alone, and never books. */

import { supabaseAdmin } from "@/lib/supabase-server";

export type BookingZone = { zone: string } | { zone: null; why: "unknown" | "invalid" | "unread" };

/** Whether Intl knows `name` as a time zone. */
export function knownZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The account's zone, read fresh. `unknown`: none synced yet; `invalid`:
    one Intl doesn't know; `unread`: the database read failed. */
export async function bookingZone(orgId: string): Promise<BookingZone> {
  const { data, error } = await supabaseAdmin.from("sm8_vendor").select("timezone_name").eq("org_id", orgId).maybeSingle();
  if (error) {
    console.error(`[sm8] couldn't read ServiceM8's time zone for org ${orgId}:`, error);
    return { zone: null, why: "unread" };
  }
  const raw = (data as { timezone_name?: unknown } | null)?.timezone_name;
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { zone: null, why: "unknown" };
  return knownZone(name) ? { zone: name } : { zone: null, why: "invalid" };
}
