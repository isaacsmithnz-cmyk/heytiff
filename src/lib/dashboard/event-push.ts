import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { daysUntil, fmtAuWeekdayDateLong, todayInAu } from "@/lib/au-dates";
import { afterResponse } from "@/lib/mobile/after-response";
import { pushToStaff } from "@/lib/mobile/push";
import { birthdayOn, birthdayWords, firstNameOf, ageOn } from "@/lib/team/birthdays";

/* THE PHONE HEARS ABOUT EVENTS AND BIRTHDAYS (Isaac, 6 November 2026,
   "Build" on https://claude.ai/artifact/L2p2fNKwDBzWJymNtwpXja):

   - an event posted: everyone on the team but its poster, "Christmas party,
     Friday 27 November" / "Isaac posted an event. Are you coming?", opening
     the event;
   - the nudge: two days before an event's answer-by day, once, to anyone
     who hasn't answered: "Christmas party: are you coming?" / "Say by
     Friday 20 November.";
   - a birthday: on the day, to everyone but its person, and only when they
     ticked Share my birthday: "It's Callum's birthday today", or "Leo turns
     30 today" when they also ticked Share my age.

   Best effort, as every push is: a failure is logged and swallowed. The two
   morning ones stamp what they sent (event_nudged_at, birthday_pushed_on), so
   a second run of the cron sends nothing twice. */

/** How many days before the answer-by day the nudge goes. */
export const NUDGE_DAYS_BEFORE = 2;

const eventPath = (id: string) => `/event?id=${id}`;

/** Everyone working here, by staff card. */
async function activeStaff(orgId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("staff_profiles").select("id").eq("org_id", orgId).eq("status", "Active");
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

export function pushEventPosted(orgId: string, event: { id: string; title: string; date: string; posterId: string | null }): void {
  afterResponse(async () => {
    const [staff, poster] = await Promise.all([
      activeStaff(orgId),
      event.posterId
        ? supabaseAdmin.from("staff_profiles").select("first_name, preferred_name, full_name").eq("org_id", orgId).eq("id", event.posterId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const to = staff.filter((id) => id !== event.posterId);
    if (!to.length) return;
    const who = poster.data ? firstNameOf(poster.data as Record<string, string | null>) : "Someone";
    await pushToStaff(orgId, to, {
      title: `${event.title}, ${fmtAuWeekdayDateLong(event.date)}`,
      body: `${who} posted an event. Are you coming?`,
      path: eventPath(event.id),
    });
  }, "an event's push");
}

/** The morning's nudges: each event whose answer-by day is close, once, to whoever hasn't answered. */
export async function sendEventNudges(today = todayInAu()): Promise<{ events: number; pushed: number }> {
  const { data } = await supabaseAdmin
    .from("notices")
    .select("id, org_id, title, posted_by, event_answer_by")
    .eq("kind", "event")
    .is("archived_at", null)
    .is("event_nudged_at", null)
    .not("event_answer_by", "is", null)
    .gte("event_answer_by", today);
  const due = ((data ?? []) as { id: string; org_id: string; title: string; posted_by: string | null; event_answer_by: string }[]).filter(
    (e) => daysUntil(String(e.event_answer_by).slice(0, 10), today) <= NUDGE_DAYS_BEFORE,
  );
  let pushed = 0;
  for (const e of due) {
    const [staff, answered] = await Promise.all([
      activeStaff(e.org_id),
      supabaseAdmin.from("notice_rsvps").select("staff_profile_id").eq("org_id", e.org_id).eq("notice_id", e.id),
    ]);
    const said = new Set(((answered.data ?? []) as { staff_profile_id: string }[]).map((r) => r.staff_profile_id));
    const to = staff.filter((id) => id !== e.posted_by && !said.has(id));
    /* stamped first: a nudge that half-went is never sent again in full */
    await supabaseAdmin.from("notices").update({ event_nudged_at: new Date().toISOString() }).eq("org_id", e.org_id).eq("id", e.id);
    if (!to.length) continue;
    pushed += await pushToStaff(e.org_id, to, {
      title: `${e.title}: are you coming?`,
      body: `Say by ${fmtAuWeekdayDateLong(String(e.event_answer_by).slice(0, 10))}.`,
      path: eventPath(e.id),
    });
  }
  return { events: due.length, pushed };
}

/** The morning's birthdays: each one shared today, to everyone else in its workspace. */
export async function sendBirthdayPushes(today = todayInAu()): Promise<{ birthdays: number; pushed: number }> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, org_id, first_name, preferred_name, full_name, birthday, share_age, birthday_pushed_on")
    .eq("share_birthday", true)
    .eq("status", "Active")
    .not("birthday", "is", null);
  type Row = { id: string; org_id: string; first_name: string | null; preferred_name: string | null; full_name: string | null; birthday: string; share_age: boolean; birthday_pushed_on: string | null };
  const rows = ((data ?? []) as Row[]).filter((r) => String(r.birthday_pushed_on ?? "").slice(0, 10) !== today && birthdayOn(r.birthday, today));
  let pushed = 0;
  for (const r of rows) {
    await supabaseAdmin.from("staff_profiles").update({ birthday_pushed_on: today }).eq("org_id", r.org_id).eq("id", r.id);
    const to = (await activeStaff(r.org_id)).filter((id) => id !== r.id);
    if (!to.length) continue;
    const age = r.share_age ? ageOn(String(r.birthday).slice(0, 10), today) : null;
    pushed += await pushToStaff(r.org_id, to, { title: birthdayWords({ name: firstNameOf(r), age }), body: null, path: "/" });
  }
  return { birthdays: rows.length, pushed };
}
