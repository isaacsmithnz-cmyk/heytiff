import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import { documentsForNotices } from "@/lib/documents/query";
import { firstNameOf, sharedBirthdays, type SharedBirthday } from "@/lib/team/birthdays";
import { asRsvpAnswer, rsvpAnswers, rsvpLabel, rsvpPeople, type RsvpAnswer } from "./events";

/* THE PHONE'S READS OF EVENTS AND BIRTHDAYS (Isaac, 6 November 2026, "Build"
   on https://claude.ai/artifact/L2p2fNKwDBzWJymNtwpXja): one event as its
   screen draws it, and the day's events and shared birthdays for Today.
   Everyone on the team sees the noticeboard's events, as on the web. */

export type EventPayload = {
  id: string;
  title: string;
  body: string | null;
  date: string;
  time: string | null;
  location: string | null;
  answerBy: string | null;
  plusOne: boolean;
  askDiet: boolean;
  image: string | null;
  answers: { id: RsvpAnswer; label: string; count: number; initials: string[] }[];
  mine: RsvpAnswer | null;
  diet: string | null;
  people: number;
  closed: boolean;
};

export type DayExtras = {
  events: { id: string; title: string; time: string | null; location: string | null; answer: RsvpAnswer | null; plusOne: boolean }[];
  birthdays: SharedBirthday[];
};

const initialsOf = (p: { first_name?: string | null; last_name?: string | null; full_name?: string | null }) => {
  const parts = [p.first_name, p.last_name].filter((x): x is string => !!x?.trim());
  const words = parts.length ? parts : (p.full_name ?? "").trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((w) => w.trim()[0]?.toUpperCase() ?? "")
    .join("");
};

export async function eventPayload(orgId: string, staffId: string | null, noticeId: string): Promise<EventPayload | null> {
  const { data } = await supabaseAdmin
    .from("notices")
    .select("id, kind, title, body, archived_at, event_date, event_time, event_location, event_plus_one, event_ask_diet, event_answer_by")
    .eq("org_id", orgId)
    .eq("id", noticeId)
    .maybeSingle();
  if (!data || data.kind !== "event" || !data.event_date) return null;

  const [rsvps, docs] = await Promise.all([
    supabaseAdmin.from("notice_rsvps").select("staff_profile_id, answer, diet").eq("org_id", orgId).eq("notice_id", noticeId),
    documentsForNotices(orgId, [noticeId]),
  ]);
  const rows = ((rsvps.data ?? []) as { staff_profile_id: string; answer: string; diet: string | null }[]).flatMap((r) => {
    const answer = asRsvpAnswer(r.answer);
    return answer ? [{ staffId: r.staff_profile_id, answer, diet: r.diet }] : [];
  });
  const ids = [...new Set(rows.map((r) => r.staffId))];
  const { data: people } = ids.length
    ? await supabaseAdmin.from("staff_profiles").select("id, first_name, last_name, full_name").eq("org_id", orgId).in("id", ids)
    : { data: [] };
  const initials = new Map(((people ?? []) as { id: string; first_name: string | null; last_name: string | null; full_name: string | null }[]).map((p) => [p.id, initialsOf(p)]));

  const plusOne = data.event_plus_one === true;
  const offered = rsvpAnswers(plusOne);
  const counted = rows.filter((r) => offered.includes(r.answer));
  const mineRow = staffId ? counted.find((r) => r.staffId === staffId) : undefined;
  const date = String(data.event_date).slice(0, 10);
  const image = (docs.get(noticeId) ?? []).find((d) => d.image && d.url)?.url ?? null;

  return {
    id: String(data.id),
    title: String(data.title),
    body: typeof data.body === "string" && data.body.trim() ? data.body : null,
    date,
    time: data.event_time ? String(data.event_time).slice(0, 5) : null,
    location: typeof data.event_location === "string" && data.event_location ? data.event_location : null,
    answerBy: data.event_answer_by ? String(data.event_answer_by).slice(0, 10) : null,
    plusOne,
    askDiet: data.event_ask_diet === true,
    image,
    answers: offered.map((a) => {
      const who = counted.filter((r) => r.answer === a);
      return { id: a, label: rsvpLabel(a, plusOne), count: who.length, initials: who.slice(0, 3).map((r) => initials.get(r.staffId) ?? "") };
    }),
    mine: mineRow?.answer ?? null,
    diet: mineRow?.diet ?? null,
    people: rsvpPeople(counted),
    closed: !!data.archived_at || date < todayInAu(),
  };
}

export async function dayExtras(orgId: string, staffId: string | null, day: string): Promise<DayExtras> {
  const [events, staff] = await Promise.all([
    supabaseAdmin
      .from("notices")
      .select("id, title, event_time, event_location, event_plus_one")
      .eq("org_id", orgId)
      .eq("kind", "event")
      .eq("event_date", day)
      .is("archived_at", null)
      .order("event_time", { ascending: true, nullsFirst: true }),
    supabaseAdmin
      .from("staff_profiles")
      .select("id, first_name, preferred_name, full_name, birthday, share_birthday, share_age")
      .eq("org_id", orgId)
      .eq("status", "Active")
      .eq("share_birthday", true),
  ]);
  const list = (events.data ?? []) as { id: string; title: string; event_time: string | null; event_location: string | null; event_plus_one: boolean }[];
  const { data: mine } =
    staffId && list.length
      ? await supabaseAdmin.from("notice_rsvps").select("notice_id, answer").eq("org_id", orgId).eq("staff_profile_id", staffId).in("notice_id", list.map((e) => e.id))
      : { data: [] };
  const answerOf = new Map(((mine ?? []) as { notice_id: string; answer: string }[]).map((r) => [r.notice_id, asRsvpAnswer(r.answer)]));

  type P = { id: string; first_name: string | null; preferred_name: string | null; full_name: string | null; birthday: string | null; share_birthday: boolean; share_age: boolean };
  const shared = sharedBirthdays(
    ((staff.data ?? []) as P[]).map((p) => ({ id: p.id, name: firstNameOf(p), birthday: p.birthday ? String(p.birthday).slice(0, 10) : null, shareBirthday: p.share_birthday, shareAge: p.share_age })),
    day,
    staffId,
  );

  return {
    events: list.map((e) => ({
      id: e.id,
      title: e.title,
      time: e.event_time ? String(e.event_time).slice(0, 5) : null,
      location: e.event_location || null,
      answer: answerOf.get(e.id) ?? null,
      plusOne: e.event_plus_one === true,
    })),
    birthdays: shared.map(({ name, age }) => ({ name, age })),
  };
}
