import { auDayOf, fmtAuWeekdayDateLong } from "@/lib/au-dates";

/* A PERSON'S ACTIVITY (Isaac, 26 November 2026: the staff page in the job
   page's dress, "1" for the person's own feed on the right, "1" for purple).
   What they did, day by day, newest first, as a job's feed says what
   happened on the job: clocking on and off, time on a site, the notes they
   wrote, the photos they took, the tasks they ticked, the leave they booked
   and the papers they filed. Over it, their week in four figures.

   Pure: the reads are person-activity-query.ts, and this turns their rows
   into the days and the figures, so both can be tested without a database. */

export type ActivityKind = "on" | "off" | "site" | "note" | "photos" | "tick" | "leave" | "papers";

/** Which of the feed's filters an entry answers to. Papers answer to All only. */
export type ActivityFilter = "all" | "hours" | "jobs" | "notes" | "leave";

export const FILTER_OF: Record<ActivityKind, ActivityFilter | null> = {
  on: "hours",
  off: "hours",
  site: "jobs",
  photos: "jobs",
  tick: "jobs",
  note: "notes",
  leave: "leave",
  papers: null,
};

export type ActivityEntry = {
  /** stable within a feed */
  key: string;
  kind: ActivityKind;
  /** the moment, an ISO timestamp: it sorts the day */
  at: string;
  /** the bold words */
  name: string;
  /** the grey words after them */
  line: string | null;
  /** said in orange after the line: the time over a normal day */
  over?: string | null;
  /** a note's own words, under the row */
  words?: string | null;
  /** the job it was on, its number its door */
  job: { uuid: string; number: string | null } | null;
};

export type ActivityDay = { day: string; label: string; entries: ActivityEntry[] };

export type ActivityStats = {
  /** null when the hours aren't the viewer's to read */
  week: { minutes: number; days: number } | null;
  /** this week's time over a normal day, day by day; null with no normal day or no hours */
  overtimeMinutes: number | null;
  /** a worked day's length over the last 13 weeks; null with none */
  averageDay: { minutes: number; days: number } | null;
  /** annual leave left, in hours, and personal (sick and carer's) */
  leave: { annualHours: number; personalHours: number; perDay: number | null } | null;
};

export type PersonActivity = { days: ActivityDay[]; stats: ActivityStats; hours: boolean; leave: boolean };

/* ── words ── */

/** "8 h 36", "45 min", "3 h" */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}

/** "6:42 am", on the AU clock */
export function fmtClock(iso: string, tz = "Australia/Sydney"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(d)
    .replace(/\s/g, " ")
    .toLowerCase();
}

/** Days from one ISO date to another, both whole days. */
function dayDiff(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

/** "Today", "Yesterday, Wednesday 25 November", "Tuesday 24 November" */
export function dayLabel(day: string, today: string): string {
  const back = dayDiff(day, today);
  if (back === 0) return "Today";
  if (back === 1) return `Yesterday, ${fmtAuWeekdayDateLong(day)}`;
  return fmtAuWeekdayDateLong(day);
}

/** The Monday of the week a date falls in, ISO. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** An ISO date `n` days before another. */
export function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** "9½ days", "1 day", or hours when there's no normal day to count in */
export function fmtLeave(hours: number, perDay: number | null): string {
  if (!perDay || perDay <= 0) return `${Math.round(hours * 10) / 10} h`;
  const halves = Math.floor((hours / perDay) * 2) / 2;
  const whole = Math.floor(halves);
  const half = halves - whole >= 0.5;
  const n = half ? (whole ? `${whole}½` : "½") : String(whole);
  return `${n} ${halves === 1 ? "day" : "days"}`;
}

/* ── the rows, as read ── */

export type ClockRow = { work_date: string; on_at: string; off_at: string | null };
export type SiteRow = { id: string; sm8_job_uuid: string; checked_in_at: string; checked_out_at: string | null };
export type NoteRow = { id: string; transcript: string; target_kind: string | null; target_id: string | null; created_at: string };
export type PhotoRow = { sm8_job_uuid: string | null; created_at: string };
export type TickRow = { id: string; sm8_job_uuid: string | null; created_at: string; task: string | null };
export type LeaveRow = { id: string; kind: string; start_date: string; end_date: string; hours: number; status: string; created_at: string };
export type PaperRow = { id: string; licence: string; expires_on: string | null; created_at: string; first: boolean };

export type ActivityRows = {
  clock: ClockRow[];
  sites: SiteRow[];
  notes: NoteRow[];
  photos: PhotoRow[];
  ticks: TickRow[];
  leave: LeaveRow[];
  papers: PaperRow[];
  /** sm8 job uuid → its number */
  numbers: Map<string, string>;
};

const LEAVE_WORD: Record<string, string> = { annual: "annual leave", personal: "personal leave", unpaid: "unpaid leave" };

/** "Monday 22 December", or "Monday 22 to Tuesday 23 December" */
function spanWords(start: string, end: string): string {
  if (start === end) return fmtAuWeekdayDateLong(start);
  const a = fmtAuWeekdayDateLong(start);
  const b = fmtAuWeekdayDateLong(end);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${a.replace(/\s\S+$/, "")} to ${b}` : `${a} to ${b}`;
}

/** The feed: every row as an entry, filed under its AU day, newest first.
    `perDayMinutes` is a normal day, for the time over it on a clock off. */
export function buildActivityDays(
  rows: ActivityRows,
  { today, since, perDayMinutes, tz }: { today: string; since: string; perDayMinutes: number | null; tz?: string },
): ActivityDay[] {
  const job = (uuid: string | null | undefined) => (uuid ? { uuid, number: rows.numbers.get(uuid) ?? null } : null);
  const entries: ActivityEntry[] = [];

  for (const c of rows.clock) {
    entries.push({ key: `on-${c.on_at}`, kind: "on", at: c.on_at, name: `Clocked on ${fmtClock(c.on_at, tz)}`, line: null, job: null });
    if (c.off_at) {
      const min = (new Date(c.off_at).getTime() - new Date(c.on_at).getTime()) / 60_000;
      const over = perDayMinutes != null && min - perDayMinutes >= 1 ? `${fmtMinutes(min - perDayMinutes)} over` : null;
      entries.push({
        key: `off-${c.off_at}`,
        kind: "off",
        at: c.off_at,
        name: `Clocked off ${fmtClock(c.off_at, tz)}`,
        line: `${fmtMinutes(min)} on the day`,
        over,
        job: null,
      });
    }
  }

  for (const s of rows.sites) {
    const min = s.checked_out_at ? (new Date(s.checked_out_at).getTime() - new Date(s.checked_in_at).getTime()) / 60_000 : null;
    entries.push({
      key: `site-${s.id}`,
      kind: "site",
      at: s.checked_in_at,
      name: min != null && min >= 1 ? `On site, ${fmtMinutes(min)}` : s.checked_out_at ? "On site" : "On site now",
      line: `arrived ${fmtClock(s.checked_in_at, tz)}`,
      job: job(s.sm8_job_uuid),
    });
  }

  for (const n of rows.notes) {
    const onJob = n.target_kind === "job" && n.target_id;
    entries.push({
      key: `note-${n.id}`,
      kind: "note",
      at: n.created_at,
      name: "Note",
      line: onJob ? "on the job" : null,
      words: n.transcript,
      job: onJob ? job(n.target_id) : null,
    });
  }

  /* photos: one entry for each job on each day, at the last of them */
  const shots = new Map<string, { uuid: string | null; at: string; count: number }>();
  for (const p of rows.photos) {
    const k = `${auDayOf(p.created_at)}|${p.sm8_job_uuid ?? ""}`;
    const was = shots.get(k);
    if (!was) shots.set(k, { uuid: p.sm8_job_uuid, at: p.created_at, count: 1 });
    else {
      was.count += 1;
      if (p.created_at > was.at) was.at = p.created_at;
    }
  }
  for (const [k, s] of shots) {
    entries.push({
      key: `photos-${k}`,
      kind: "photos",
      at: s.at,
      name: s.count === 1 ? "Added a photo" : `Added ${s.count} photos`,
      line: null,
      job: job(s.uuid),
    });
  }

  for (const t of rows.ticks) {
    entries.push({ key: `tick-${t.id}`, kind: "tick", at: t.created_at, name: t.task ? `Ticked ${t.task}` : "Ticked a task", line: null, job: job(t.sm8_job_uuid) });
  }

  for (const l of rows.leave) {
    if (l.status === "cancelled" || l.status === "declined") continue;
    const word = LEAVE_WORD[l.kind] ?? "leave";
    entries.push({
      key: `leave-${l.id}`,
      kind: "leave",
      at: l.created_at,
      name: l.status === "pending" ? `Asked for ${word}` : `Booked ${word}`,
      line: spanWords(l.start_date, l.end_date),
      job: null,
    });
  }

  for (const p of rows.papers) {
    entries.push({
      key: `papers-${p.id}`,
      kind: "papers",
      at: p.created_at,
      name: `${p.first ? "Added" : "Renewed"} ${p.licence}`,
      line: p.expires_on ? `expires ${fmtAuWeekdayDateLong(p.expires_on).replace(/^\S+\s/, "")} ${p.expires_on.slice(0, 4)}` : null,
      job: null,
    });
  }

  const byDay = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const day = auDayOf(e.at);
    if (!day || day < since || day > today) continue;
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({
      day,
      label: dayLabel(day, today),
      entries: list.sort((a, b) => b.at.localeCompare(a.at)),
    }));
}

/** This week's hours, the time over a normal day on each day of it, and the
    average day. Overtime is counted day by day, so it reads true on a
    Wednesday, not only once the week is done. */
export function hoursStats(
  clock: ClockRow[],
  { today, perDayMinutes, now = new Date() }: { today: string; perDayMinutes: number | null; now?: Date },
): Pick<ActivityStats, "week" | "overtimeMinutes" | "averageDay"> {
  const monday = mondayOf(today);
  const len = (c: ClockRow) => {
    const end = c.off_at ? new Date(c.off_at).getTime() : c.work_date === today ? now.getTime() : null;
    return end == null ? null : Math.max(0, (end - new Date(c.on_at).getTime()) / 60_000);
  };
  let weekMin = 0;
  const weekDays = new Map<string, number>();
  for (const c of clock) {
    if (c.work_date < monday || c.work_date > today) continue;
    const m = len(c);
    if (m == null) continue;
    weekMin += m;
    weekDays.set(c.work_date, (weekDays.get(c.work_date) ?? 0) + m);
  }
  const over = perDayMinutes != null ? [...weekDays.values()].reduce((a, m) => a + Math.max(0, m - perDayMinutes), 0) : null;
  /* the average is of days that ended: one still going isn't a day yet */
  const done = clock.filter((c) => c.off_at && c.work_date >= daysBefore(today, 91) && c.work_date < today);
  const perDay = new Map<string, number>();
  for (const c of done) perDay.set(c.work_date, (perDay.get(c.work_date) ?? 0) + (len(c) ?? 0));
  const avg = perDay.size ? [...perDay.values()].reduce((a, b) => a + b, 0) / perDay.size : null;
  return {
    week: { minutes: weekMin, days: weekDays.size },
    overtimeMinutes: over,
    averageDay: avg != null ? { minutes: avg, days: perDay.size } : null,
  };
}
