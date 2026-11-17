/* HOME'S SCHEDULE, the pure half (Isaac, 17 November 2026: "the person
   who's going to be looking at the desktop screen over the app is probably
   going to be the admin person on a daily basis. So it would make more sense
   for it to have the team's job locations across the map", "default would
   be team view", then "Build it" to the two tabs on
   https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF).

   A day's jobs, each once, in start order: its number and colour, the
   client, the suburb, who's on it by first name, its start, where it's up
   to, and where it is for the map. Read off the Schedule's own layout of
   the day (lib/workboard/schedule), whose lanes already say whose each
   booking is, so a job booked to four people is one row with four names.

   Pure: the clock is the caller's (`nowMin`, the account's minute), so the
   server and the browser agree on the words. */

import type { Hue } from "@/components/parts/state";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { jobPageHref } from "@/lib/shell/links";
import { plusDays } from "@/lib/workboard/dates";
import { jobHue } from "@/lib/workboard/job-hue";
import type { ScheduleDay } from "@/lib/workboard/schedule";
import { andList, clock, type TodayState } from "./home-today";

export type TeamJob = {
  /** The job's uuid: one row per job, however many bookings it has. */
  id: string;
  number: string | null;
  client: string;
  suburb: string | null;
  /** The job's kind ("Install"), its category's name, or "Visit". */
  kind: string;
  hue: Hue;
  /** Who's booked on it, by first name, in the Schedule's lane order; the
      viewer is "you". */
  people: string[];
  /** One of the bookings is the viewer's. */
  mine: boolean;
  startMin: number;
  /** "7:30": the first booking's start, as the Schedule's cards write it. */
  time: string;
  state: TodayState | null;
  /** Done: grey on the list, a dot on the map. */
  done: boolean;
  /** Where ServiceM8 put it; null where it hasn't. */
  at: { lat: number; lng: number } | null;
  /** Who has clocked on to it today, by first name ("you" for the viewer):
      the map puts them beside it. Today only. */
  here: string[];
  href: string;
};

/** Someone clocked on whose phone said where they are (lib/mobile/where),
    where the business has its team's location on. Today only. */
export type LivePerson = {
  /** First name, or "you". */
  name: string;
  at: { lat: number; lng: number };
  /** How many minutes ago the phone said so. */
  mins: number;
};

export type TeamDay = {
  /** YYYY-MM-DD */
  day: string;
  /** Is this the account's today: only today says Done by the clock, On
      site, and who's where. */
  today: boolean;
  jobs: TeamJob[];
  /** Schedule capacity's people with nothing booked and no time off, by
      first name. */
  free: string[];
  /** The viewer's ServiceM8 person is known: You can narrow to them. */
  linked: boolean;
  /** Where the team is now, for the map; empty where the business has it off. */
  live: LivePerson[];
};

const first = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/** The words for a job's line under its client: "Glebe, with Ryan, Sam and
    Marco"; on You, "Install, Glebe". */
export function teamLine(job: Pick<TeamJob, "suburb" | "people" | "kind">, view: "team" | "you"): string {
  if (view === "you") return [job.kind, job.suburb].filter(Boolean).join(", ");
  const who = job.people.length ? `with ${andList(job.people)}` : "nobody booked";
  return job.suburb ? `${job.suburb}, ${who}` : who.charAt(0).toUpperCase() + who.slice(1);
}

/** The day's jobs, one row each, from the Schedule's layout of the day. */
export function teamDayOf(
  day: Pick<ScheduleDay, "lanes"> | null,
  opts: {
    dayISO: string;
    today: boolean;
    nowMin: number | null;
    /** The viewer's ServiceM8 person, or null where none is linked. */
    mine: string | null;
    places?: Readonly<Record<string, { lat: number; lng: number }>>;
    free?: readonly string[];
    /** Where the team is now, each with their ServiceM8 person where known:
        someone the map shows where they are isn't drawn beside a job too. */
    live?: readonly (LivePerson & { sm8: string | null })[];
  },
): TeamDay {
  type Acc = TeamJob & { endMin: number; open: boolean; gone: boolean; lost: boolean; stale: boolean };
  const by = new Map<string, Acc>();
  const low = (u: string | null) => (u ?? "").toLowerCase();
  const now = opts.today ? opts.nowMin : null;
  const placed = new Set((opts.today ? (opts.live ?? []) : []).map((p) => low(p.sm8)).filter(Boolean));
  for (const lane of day?.lanes ?? []) {
    const who = lane.staffUuid ? (opts.mine && low(lane.staffUuid) === low(opts.mine) ? "you" : first(lane.name)) : null;
    for (const b of lane.blocks) {
      let j = by.get(b.remoteId);
      if (!j) {
        const number = b.jobNumber?.trim() || null;
        j = {
          id: b.remoteId,
          number,
          client: b.clientName?.trim() || b.suburb?.trim() || (number ? `Job ${number}` : "Unnamed client"),
          suburb: b.suburb?.trim() || null,
          kind: b.categoryName?.trim() || b.tracked?.label?.trim() || "Visit",
          hue: jobHue(b.categoryColour, b.status),
          people: [],
          mine: false,
          startMin: b.startMin,
          time: "",
          state: null,
          done: false,
          at: opts.places?.[b.remoteId] ?? null,
          here: [],
          href: jobPageHref(b.remoteId),
          endMin: b.endMin,
          open: false,
          gone: false,
          lost: (b.status ?? "").trim().toLowerCase() === "unsuccessful",
          stale: false,
        };
        by.set(b.remoteId, j);
      }
      j.startMin = Math.min(j.startMin, b.startMin);
      j.endMin = Math.max(j.endMin, b.endMin);
      if (who && !j.people.includes(who)) j.people.push(who);
      if (who === "you") j.mine = true;
      if (b.closure !== "done") j.open = true;
      if (b.closure === "stale") j.stale = true;
      if (now !== null && b.onSite && who && !j.here.includes(who) && !placed.has(low(lane.staffUuid))) j.here.push(who);
    }
  }
  const jobs = [...by.values()]
    .map(({ endMin, open, gone: _gone, lost, stale, ...j }): TeamJob => {
      const done = !lost && (!open || (now !== null && now >= endMin));
      const state: TodayState | null = lost
        ? { tone: "wrong", word: "Didn't go ahead" }
        : done
          ? { tone: "good", word: "Done" }
          : stale
            ? { tone: "look", word: "Job closed" }
            : now === null
              ? null
              : j.here.length > 0
                ? { tone: "good", word: "On site" }
                : now >= j.startMin
                  ? { tone: "info", word: "On now" }
                  : { tone: "info", word: "Booked" };
      return { ...j, time: clock(j.startMin), state, done, here: done ? [] : j.here };
    })
    .sort((a, b) => a.startMin - b.startMin || (a.number ?? "").localeCompare(b.number ?? "", "en", { numeric: true }));
  return {
    day: opts.dayISO,
    today: opts.today,
    jobs,
    free: (opts.free ?? []).map(first).filter(Boolean),
    linked: opts.mine !== null,
    live: opts.today ? (opts.live ?? []).map(({ name, at, mins }) => ({ name: first(name), at, mins })) : [],
  };
}

/** "Nathan, Mia and Liam are free all day." — or nothing to say. */
export function freeLine(free: readonly string[]): string | null {
  if (free.length === 0) return null;
  const said = `${andList(free)} ${free.length === 1 && free[0] !== "you" ? "is" : "are"} free all day.`;
  return said.charAt(0).toUpperCase() + said.slice(1);
}

export type HomeDay = { day: string; label: string };

const weekday = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** The days along the top of Home's Schedule: Today, then the next working
    days by name and date ("Wed 18"), Saturday and Sunday passed over. */
export function homeDays(todayISO: string, ahead = 4): HomeDay[] {
  const out: HomeDay[] = [{ day: todayISO, label: "Today" }];
  let d = todayISO;
  while (out.length <= ahead) {
    d = plusDays(d, 1);
    const w = weekday(d);
    if (w === 0 || w === 6) continue;
    out.push({ day: d, label: fmtAuWeekdayDayMonth(d).replace(/\s+\S+$/, "") });
  }
  return out;
}
