"use server";

import { revalidatePath } from "next/cache";
import { navHref } from "@/components/shell/nav";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";

/* THE HOME CALENDAR'S WRITES (docs/migrations/calendar_events.sql).

   WHO: anyone holding `team` adds to the calendar — the same gate as
   posting a notice (Isaac's call, 2026-09-25) — and everyone with Home
   reads it. The page hides the box from anyone else, but the page is never
   the control: the gate is decided here, on every call.

   SCOPED BY THE SESSION. The row's workspace is the caller's, read off the
   session; nothing in the request can name another one, and the author is
   the caller's own staff card or nobody.

   Save is here. Sort it out and the Tiff button reach the calendar through
   Tiff (the calendar's own filing comes with its pull request, as do Edit
   and Delete). */

export type CalendarAddResult = { ok: true; id: string; day: string } | { ok: false; error: string };

/** The table's own ceiling (`calendar_events.title`, 1 to 120 characters). */
const TITLE_MAX = 120;

/* By name, not by path: a revalidate aimed at a moved route fails silently
   (see the note on `refresh` in ./kb). */
const refresh = () => revalidatePath(navHref("home"));

/** Save: the words as typed, on the workspace's today, all day. Tiff is not
    asked — what you typed is what goes on the calendar, and a day, a time
    or a repeat in the words is Sort it out's to read.

    THE WORKSPACE'S DAY, the one the calendar draws Today on and "Your day"
    above it (lib/calendar/query): the ServiceM8 account's zone, Sydney
    without one. Sydney's own day would put a late-evening Save in Perth on
    tomorrow. It is read here rather than taken from the page, so a page
    left open past midnight still saves on the day it is. */
export async function addCalendarEvent(text: string): Promise<CalendarAddResult> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { ok: false, error: "Not signed in." };
  if (!(await can("team"))) return { ok: false, error: "You can't add to the calendar." };

  const title = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX).trim() : "";
  if (!title) return { ok: false, error: "Give it a name first." };

  const [staffId, tz] = await Promise.all([staffProfileIdFor(orgId, userId), getSm8Timezone(orgId)]);
  const day = todayInZone(tz);

  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .insert({
      org_id: orgId,
      kind: "event",
      title,
      starts_on: day,
      ends_on: day,
      created_by: staffId,
      source: "typed",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add that to the calendar." };

  refresh();
  return { ok: true, id: String((data as { id: string }).id), day };
}
