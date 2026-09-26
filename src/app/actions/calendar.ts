"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { navHref } from "@/components/shell/nav";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { companyWindow } from "@/lib/calendar/items";
import { readCalendarLine } from "@/lib/calendar/line-brain";
import { MAX_OCCURRENCES } from "@/lib/calendar/repeat";
import { toDay } from "@/lib/calendar/days";
import {
  DAY_ASKS,
  NOTE_MAX,
  NO_DAY,
  WHICH_DAY,
  filedLine,
  lineAbout,
  lineDates,
  lineDoor,
  linePlan,
  outsideLine,
  takenBackLine,
  withNote,
  type LinePlanRow,
} from "@/lib/calendar/line";

/* THE HOME CALENDAR'S WRITES (docs/migrations/calendar_events.sql).

   WHO: anyone holding `team` adds to the calendar and changes what is on it
   — the same gate as posting a notice (Isaac's call, 2026-09-25) — and
   everyone with Home reads it. The page hides the box and Edit from anyone
   else, but the page is never the control: the gate is decided here, on
   every call.

   SCOPED BY THE SESSION. The row's workspace is the caller's, read off the
   session; nothing in the request can name another one, every read and
   write names both keys (the workspace and the row), and the author is the
   caller's own staff card or nobody.

   Four doors:
     Save          `addCalendarEvent`: the words as typed, on today.
     Sort it out   `fileCalendarLine`: Tiff reads the line — a day, a time,
                   a repeat — and it goes on as she read it, a repeat as one
                   row per date under one series; a reply after it is kept on
                   what she filed (`noteOnCalendarEvents`), and Undo takes it
                   off (`undoCalendarLine`).
     Edit          `editCalendarEvent`: this one, or the whole series.
     Delete        `deleteCalendarEvent`: this one, or all of the series. */

export type CalendarAddResult = { ok: true; id: string; day: string } | { ok: false; error: string };
export type CalendarResult = { ok: true } | { ok: false; error: string };

/** The table's own ceilings (`calendar_events`). The title's is 1 to 120
    characters, counted as Postgres counts them: by character, not by UTF-16
    unit. */
const TITLE_MAX = 120;
const WHERE_MAX = 120;
const WHO_MAX = 80;
/** A line for the calendar is a sentence or two, and an answer a few words. */
const LINE_MAX = 2000;
const ANSWER_MAX = 500;

const NOT_SIGNED_IN = "Not signed in.";
const NO_TEAM = "You can't add to the calendar.";
const NO_CHANGE = "You can't change the calendar.";
const COULDNT_ADD = "Couldn't add that to the calendar.";
const COULDNT_CHANGE = "Couldn't change that on the calendar.";
const GONE = "That's no longer on the calendar.";

/* By name, not by path: a revalidate aimed at a moved route fails silently
   (see the note on `refresh` in ./kb). */
const refresh = () => revalidatePath(navHref("home"));

/** The caller, when they may write to the calendar; otherwise why not. */
async function gate(refused: string): Promise<{ orgId: string; userId: string } | { error: string }> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { error: NOT_SIGNED_IN };
  if (!(await can("team"))) return { error: refused };
  return { orgId, userId };
}

/** One line, the table's width: runs of space folded, trimmed, cut. */
const oneLine = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";

/** The rows a browser names, as ids: strings, each once, no more than one
    series can hold. */
function idsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) if (typeof v === "string" && v.trim() && v.length <= 64) out.add(v.trim());
  return [...out].slice(0, MAX_OCCURRENCES);
}

/** Save: the words as typed, on the workspace's today, all day. Tiff is not
    asked — what you typed is what goes on the calendar, and a day, a time
    or a repeat in the words is Sort it out's to read.

    AS TYPED, OR NOT AT ALL. Words past the table's 120 are refused, never
    cut: the box keeps whatever a Save refuses and says why, and it empties
    only for a Save that went in, so a line cut short would lose its end
    with nothing to say it had.

    THE WORKSPACE'S DAY, the one the calendar draws Today on and "Your day"
    above it (lib/calendar/query): the ServiceM8 account's zone, Sydney
    without one. Sydney's own day would put a late-evening Save in Perth on
    tomorrow. It is read here rather than taken from the page, so a page
    left open past midnight still saves on the day it is. */
export async function addCalendarEvent(text: string): Promise<CalendarAddResult> {
  const who = await gate(NO_TEAM);
  if ("error" in who) return { ok: false, error: who.error };
  const { orgId, userId } = who;

  const title = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!title) return { ok: false, error: "Give it a name first." };
  if ([...title].length > TITLE_MAX) return { ok: false, error: `Keep it to ${TITLE_MAX} characters.` };

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
  if (error || !data) return { ok: false, error: COULDNT_ADD };

  refresh();
  return { ok: true, id: String((data as { id: string }).id), day };
}

/* ── Sort it out ── */

export type CalendarLineResult =
  | {
      ok: true;
      /** Her line: "Done. Toolbox talk is on the calendar for Thu 1 Oct …". */
      say: string;
      plan: LinePlanRow[];
      /** "11 events on the calendar". */
      door: string;
      /** Every row it put on, for Undo, a reply's note and the page's light. */
      ids: string[];
      /** "the toolbox talk on Thu 1 Oct": what a reply is kept on. */
      about: string;
    }
  /** No day in it: she asks, and the answer comes back with the line. */
  | { ok: false; ask: string }
  /** `unread`: the line was never read, so its words should be kept as said. */
  | { ok: false; error: string; unread?: boolean };

/** Sort it out, and the calendar's Tiff button: Tiff reads the line and it
    goes on the calendar as she read it, at once — the modal files live, and
    Undo is the net (Isaac's call, 2026-09-25). A repeat ("every first
    Thursday") goes on as one row per date, counted by lib/calendar/repeat up
    to the calendar's window end, all in one insert under one series; a line
    with no day she can read is asked about ("Which day?"), and the answers
    come back with the line, which is read again whole. She asks three times
    at most. The rows are the caller's workspace's, on its own day, as ever. */
export async function fileCalendarLine(
  text: string,
  source: "text" | "voice" = "text",
  answers: readonly string[] = [],
): Promise<CalendarLineResult> {
  const who = await gate(NO_TEAM);
  if ("error" in who) return { ok: false, error: who.error };
  const { orgId, userId } = who;

  const line = typeof text === "string" ? text.trim().slice(0, LINE_MAX).trim() : "";
  if (!line) return { ok: false, error: "There was nothing in that line." };
  const said = (Array.isArray(answers) ? answers : [])
    .map((a) => oneLine(a, ANSWER_MAX))
    .filter(Boolean)
    .slice(-DAY_ASKS);

  const [staffId, tz] = await Promise.all([staffProfileIdFor(orgId, userId), getSm8Timezone(orgId)]);
  const today = todayInZone(tz);
  const win = companyWindow(today);
  if (!win) return { ok: false, error: COULDNT_ADD };

  const read = await readCalendarLine(line, { today, windowEnd: win.windowEnd }, said);
  if (!read.ok) return { ok: false, error: read.error, unread: true };
  const l = read.line;

  const dates = lineDates(l, { today, ...win });
  if (!dates.ok) {
    if (dates.why !== "no-day") return { ok: false, error: outsideLine(dates.why, win.windowEnd) };
    return said.length >= DAY_ASKS ? { ok: false, error: NO_DAY } : { ok: false, ask: WHICH_DAY };
  }

  /* One series for a repeat, its rule kept beside every row it made. */
  const series = l.repeat ? randomUUID() : null;
  const rows = dates.days.map((day) => ({
    org_id: orgId,
    kind: l.kind,
    title: l.title,
    starts_on: day,
    ends_on: dates.lastDay ?? day,
    starts_at: l.time,
    ends_at: l.endTime,
    location: l.where,
    audience: l.who,
    series_id: series,
    repeat: series ? l.repeat : null,
    created_by: staffId,
    source: source === "voice" ? "voice" : "sorted",
  }));
  const { data, error } = await supabaseAdmin.from("calendar_events").insert(rows).select("id");
  if (error || !data?.length) return { ok: false, error: COULDNT_ADD };

  refresh();
  return {
    ok: true,
    say: filedLine(l, dates),
    plan: linePlan(l, dates),
    door: lineDoor(dates),
    ids: (data as { id: string }[]).map((r) => String(r.id)),
    about: lineAbout(l, dates),
  };
}

/** A reply to Tiff after she filed: kept on what she filed, as its note (his
    prototype: "Put it in the yard" goes on the toolbox talk). Added to what
    the note already says, never over it. */
export async function noteOnCalendarEvents(ids: readonly string[], text: string): Promise<CalendarResult> {
  const who = await gate(NO_CHANGE);
  if ("error" in who) return { ok: false, error: who.error };
  const want = idsOf(ids);
  const said = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) : "";
  if (!said) return { ok: false, error: "There was nothing to add." };
  if (!want.length) return { ok: false, error: GONE };

  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .select("id, note")
    .eq("org_id", who.orgId)
    .in("id", want);
  if (error) return { ok: false, error: COULDNT_CHANGE };
  const rows = (data ?? []) as { id: string; note: string | null }[];
  if (!rows.length) return { ok: false, error: GONE };

  const at = new Date().toISOString();
  const wrote = await Promise.all(
    rows.map((r) =>
      supabaseAdmin
        .from("calendar_events")
        .update({ note: withNote(r.note, said), updated_at: at })
        .eq("org_id", who.orgId)
        .eq("id", r.id),
    ),
  );
  if (wrote.some((w) => w.error)) return { ok: false, error: COULDNT_CHANGE };
  refresh();
  return { ok: true };
}

/** Undo in the modal: what one filing put on, off again. Only those rows,
    and only this workspace's. */
export async function undoCalendarLine(
  ids: readonly string[],
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const who = await gate(NO_CHANGE);
  if ("error" in who) return { ok: false, error: who.error };
  const want = idsOf(ids);
  if (!want.length) return { ok: false, error: GONE };
  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .delete()
    .eq("org_id", who.orgId)
    .in("id", want)
    .select("id");
  if (error) return { ok: false, error: COULDNT_CHANGE };
  const n = (data ?? []).length;
  if (!n) return { ok: false, error: GONE };
  refresh();
  return { ok: true, summary: takenBackLine(n) };
}

/* ── Edit and Delete ── */

/** What the edit form sends: the event's own fields, as the form holds them. */
export type CalendarEventPatch = {
  title: string;
  /** ISO days. `endsOn` is the last day of a range; a series is one day. */
  startsOn: string;
  endsOn?: string | null;
  /** Wall-clock "HH:MM", or null for all day. */
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  audience: string | null;
  note: string | null;
};

/** One of a series, or all of it. */
export type SeriesScope = "one" | "series";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A form's time: "HH:MM", or nothing for all day. Undefined when it is
    something else, which is refused rather than read. */
function formTime(v: unknown): string | null | undefined {
  if (v == null || v === "") return null;
  const s = typeof v === "string" ? v.trim().slice(0, 5) : "";
  return HHMM.test(s) ? s : undefined;
}

const formText = (v: unknown, max: number): string | null => oneLine(v, max) || null;

/** The calendar's twelve months as the workspace's calendar draws them
    today (lib/calendar/query reads the same): what "all" of a series is. */
async function seriesWindow(orgId: string) {
  return companyWindow(todayInZone(await getSm8Timezone(orgId)));
}

/** The row the form is about, in the caller's workspace, or null. */
async function eventRow(orgId: string, id: string) {
  const { data } = await supabaseAdmin
    .from("calendar_events")
    .select("id, kind, series_id")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return data ? (data as { id: string; kind: string; series_id: string | null }) : null;
}

/** Edit: this one, or all of its series. A series' dates are its rule's, one
    day each, so "all" changes what every date says — the name, the hours,
    where, who and the note — and moves only this one's day; each of the
    others keeps its own. A shutdown has no hours (the table refuses them).

    "ALL" IS WHAT THE BUTTON COUNTED. "Save all 11" and "Delete all 11" count
    the dates the calendar shows, its twelve months from the 1st of this
    one, so all is those dates: a date of the series from a month gone by
    is not on the calendar, was not counted, and stays as it was, the
    record of what happened. */
export async function editCalendarEvent(
  id: string,
  patch: CalendarEventPatch,
  scope: SeriesScope = "one",
): Promise<CalendarResult> {
  const who = await gate(NO_CHANGE);
  if ("error" in who) return { ok: false, error: who.error };
  if (typeof id !== "string" || !id) return { ok: false, error: GONE };
  const p = (patch && typeof patch === "object" ? patch : {}) as Partial<CalendarEventPatch>;

  /* The name as typed, or refused: never cut, as Save's. */
  const title = typeof p.title === "string" ? p.title.replace(/\s+/g, " ").trim() : "";
  if (!title) return { ok: false, error: "Give it a name first." };
  if ([...title].length > TITLE_MAX) return { ok: false, error: `Keep it to ${TITLE_MAX} characters.` };
  const startsOn = typeof p.startsOn === "string" ? p.startsOn : "";
  if (Number.isNaN(toDay(startsOn))) return { ok: false, error: "Pick the day it's on." };

  const row = await eventRow(who.orgId, id);
  if (!row) return { ok: false, error: GONE };
  const inSeries = !!row.series_id;

  const endsRaw = typeof p.endsOn === "string" && p.endsOn ? p.endsOn : startsOn;
  if (Number.isNaN(toDay(endsRaw))) return { ok: false, error: "Pick the day it ends." };
  if (endsRaw < startsOn) return { ok: false, error: "It can't end before it starts." };
  /* A date in a series is one day. */
  const endsOn = inSeries ? startsOn : endsRaw;

  const shutdown = row.kind === "shutdown";
  const startsAt = shutdown ? null : formTime(p.startsAt);
  const endsAt = shutdown ? null : formTime(p.endsAt);
  if (startsAt === undefined || endsAt === undefined) return { ok: false, error: "That time isn't one I can read." };
  if (endsAt && !startsAt) return { ok: false, error: "Give it a start time first." };
  if (endsAt && startsAt && endsOn === startsOn && endsAt <= startsAt) {
    return { ok: false, error: "It has to finish after it starts." };
  }

  const said = {
    title,
    starts_at: startsAt,
    ends_at: endsAt,
    location: formText(p.location, WHERE_MAX),
    audience: formText(p.audience, WHO_MAX),
    note: typeof p.note === "string" ? p.note.trim().slice(0, NOTE_MAX).trim() || null : null,
    updated_at: new Date().toISOString(),
  };

  if (scope === "series" && row.series_id) {
    const win = await seriesWindow(who.orgId);
    if (!win) return { ok: false, error: COULDNT_CHANGE };
    const all = await supabaseAdmin
      .from("calendar_events")
      .update(said)
      .eq("org_id", who.orgId)
      .eq("series_id", row.series_id)
      .gte("starts_on", win.windowStart)
      .lte("starts_on", win.windowEnd);
    if (all.error) return { ok: false, error: COULDNT_CHANGE };
  }
  const one = await supabaseAdmin
    .from("calendar_events")
    .update({ ...said, starts_on: startsOn, ends_on: endsOn })
    .eq("org_id", who.orgId)
    .eq("id", row.id);
  if (one.error) return { ok: false, error: COULDNT_CHANGE };

  refresh();
  return { ok: true };
}

/** Delete: this one, or every date of its series the calendar shows — the
    dates "Delete all 11" counted (see `editCalendarEvent`). */
export async function deleteCalendarEvent(
  id: string,
  scope: SeriesScope = "one",
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const who = await gate(NO_CHANGE);
  if ("error" in who) return { ok: false, error: who.error };
  if (typeof id !== "string" || !id) return { ok: false, error: GONE };
  const row = await eventRow(who.orgId, id);
  if (!row) return { ok: false, error: GONE };

  const all = scope === "series" && !!row.series_id;
  const win = all ? await seriesWindow(who.orgId) : null;
  if (all && !win) return { ok: false, error: COULDNT_CHANGE };
  const gone =
    win && row.series_id
      ? await supabaseAdmin
          .from("calendar_events")
          .delete()
          .eq("org_id", who.orgId)
          .eq("series_id", row.series_id)
          .gte("starts_on", win.windowStart)
          .lte("starts_on", win.windowEnd)
          .select("id")
      : await supabaseAdmin.from("calendar_events").delete().eq("org_id", who.orgId).eq("id", row.id).select("id");
  if (gone.error) return { ok: false, error: COULDNT_CHANGE };

  refresh();
  return { ok: true, count: (gone.data ?? []).length };
}
