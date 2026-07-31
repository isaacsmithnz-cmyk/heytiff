/* What "urgent" and "needs attention" actually MEAN — pure, and defined once.

   The Workboard's top row is three numbers a foreman acts on before their
   first coffee, so the rules behind them cannot live scattered through JSX
   where they drift apart and nobody can say why a row went red. They live
   here, and they are ordinary functions over the existing query types.

   NO I/O AND NO CLOCK: `today` is handed in, already resolved on the
   ACCOUNT's timezone by dates.ts. A module that reads new Date() would bucket
   a Perth service as overdue while it's still Sunday over there, and would
   also be untestable without freezing time.

   Every flag carries its REASON as text. A red dot nobody can explain gets
   ignored within a week; "No movement for 11 days" gets actioned. */

import { daysUntil } from "@/lib/au-dates";
import type { RadarItem } from "./maintenance-query";
import type { ProjectStripItem } from "./projects-query";

/** A service is worth chasing once it's inside this window AND not fully
    prepped. Two weeks is the shortest notice that still lets you order a
    part, book access and ring the customer without anyone rushing. */
export const ATTENTION_WINDOW_DAYS = 14;

/** A project that hasn't moved in a fortnight isn't "in progress", whatever
    the stage says. One week is a nudge; two is a problem. */
export const PROJECT_ATTENTION_DAYS = 7;
export const PROJECT_URGENT_DAYS = 14;

export type Tone = "urgent" | "attention" | "calm";

export type Vital = {
  key: string;
  label: string;
  count: number;
  /** The detail a foreman asks for next, once the number has their eye. */
  caption: string;
  tone: Tone;
};

/* ── maintenance ── */

export type MaintenanceVitals = {
  /** Overdue — the promise is already broken. */
  urgent: RadarItem[];
  /** Due inside the window with prep still missing. */
  attention: RadarItem[];
  /** Everything open on the radar. */
  all: RadarItem[];
  tiles: [Vital, Vital, Vital];
};

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function maintenanceVitals(radar: RadarItem[], today: string): MaintenanceVitals {
  const urgent = radar.filter((r) => r.bucket === "overdue");
  const attention = radar.filter(
    (r) =>
      r.bucket !== "overdue" &&
      r.ready < r.readyTotal &&
      daysUntil(r.dueDate, today) <= ATTENTION_WINDOW_DAYS
  );

  // The oldest breach is the one that gets asked about, so it's the caption.
  const oldest = urgent.reduce(
    (worst, r) => Math.max(worst, -daysUntil(r.dueDate, today)),
    0
  );

  // Prep is a fraction, not a feeling: how many of the four checks are ticked
  // across everything currently in the window.
  const ticked = attention.reduce((n, r) => n + r.ready, 0);
  const checks = attention.reduce((n, r) => n + r.readyTotal, 0);

  const agreements = new Set(radar.map((r) => r.agreementId)).size;
  const next = radar.find((r) => r.bucket !== "overdue")?.dueDate ?? null;

  return {
    urgent,
    attention,
    all: radar,
    tiles: [
      {
        key: "urgent",
        label: "Urgent",
        count: urgent.length,
        caption:
          urgent.length === 0
            ? "Nothing has slipped"
            : `Oldest is ${oldest} ${plural(oldest, "day")} over`,
        tone: urgent.length > 0 ? "urgent" : "calm",
      },
      {
        key: "attention",
        label: "Needs attention",
        count: attention.length,
        caption:
          attention.length === 0
            ? "Everything ahead is prepped"
            : `${ticked} of ${checks} checks ticked`,
        tone: attention.length > 0 ? "attention" : "calm",
      },
      {
        key: "all",
        label: "Services on the radar",
        count: radar.length,
        caption:
          radar.length === 0
            ? "No agreements running"
            : `Across ${agreements} ${plural(agreements, "agreement")}` +
              (next ? ` · next in ${Math.max(daysUntil(next, today), 0)} days` : ""),
        tone: "calm",
      },
    ],
  };
}

/* ── projects ── */

export type ProjectFlag = {
  tone: Exclude<Tone, "calm"> | null;
  /** Null when the project is fine — the card shows nothing rather than a
      reassuring badge nobody reads. */
  reason: string | null;
};

/** Days since a project last moved. `updatedAt` is a timestamp; only its
    calendar date matters here, so it's sliced rather than reinterpreted. */
export function staleDays(p: ProjectStripItem, today: string): number {
  if (!p.updatedAt) return 0;
  const day = p.updatedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
  return Math.max(-daysUntil(day, today), 0);
}

/** The one place a project earns a colour.

    Staleness is the honest signal the schema actually holds: there is no due
    date on a project, but `updated_at` moves every time someone ticks a
    checklist item or advances a stage, so "nobody has touched this" is real
    and not a guess. `on_hold` outranks it — a held project is a decision
    someone made, and it should be visible whether it moved yesterday or not. */
export function projectFlag(p: ProjectStripItem, today: string): ProjectFlag {
  if (p.status === "on_hold") return { tone: "urgent", reason: "On hold" };
  const days = staleDays(p, today);
  if (days >= PROJECT_URGENT_DAYS) return { tone: "urgent", reason: `No movement for ${days} days` };
  if (days >= PROJECT_ATTENTION_DAYS)
    return { tone: "attention", reason: `No movement for ${days} days` };
  return { tone: null, reason: null };
}

export type ProjectVitals = {
  urgent: ProjectStripItem[];
  attention: ProjectStripItem[];
  all: ProjectStripItem[];
  tiles: [Vital, Vital, Vital];
};

export function projectVitals(projects: ProjectStripItem[], today: string): ProjectVitals {
  const flagged = projects.map((p) => ({ p, flag: projectFlag(p, today) }));
  const urgent = flagged.filter((x) => x.flag.tone === "urgent").map((x) => x.p);
  const attention = flagged.filter((x) => x.flag.tone === "attention").map((x) => x.p);

  const quietest = projects.reduce((worst, p) => Math.max(worst, staleDays(p, today)), 0);
  const held = projects.filter((p) => p.status === "on_hold").length;

  // Where the work actually is, in one phrase: the busiest stage.
  const byStage = new Map<string, number>();
  for (const p of projects) byStage.set(p.stage, (byStage.get(p.stage) ?? 0) + 1);
  const busiest = [...byStage.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  return {
    urgent,
    attention,
    all: projects,
    tiles: [
      {
        key: "urgent",
        label: "Urgent",
        count: urgent.length,
        caption:
          urgent.length === 0
            ? "Nothing stuck"
            : held > 0
              ? `${held} on hold · quietest ${quietest} days`
              : `Quietest is ${quietest} ${plural(quietest, "day")}`,
        tone: urgent.length > 0 ? "urgent" : "calm",
      },
      {
        key: "attention",
        label: "Needs attention",
        count: attention.length,
        caption: attention.length === 0 ? "All moving" : "Going quiet — chase this week",
        tone: attention.length > 0 ? "attention" : "calm",
      },
      {
        key: "all",
        label: "Live projects",
        count: projects.length,
        caption:
          projects.length === 0
            ? "Nothing on the go"
            : busiest
              ? `${busiest[1]} in ${busiest[0]}`
              : "",
        tone: "calm",
      },
    ],
  };
}

/* ── the load timeline ── */

export type LoadState = "overdue" | "attention" | "ready";

export type LoadItem = {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  label: string;
  state: LoadState;
};

export type LoadBucket = {
  key: string;
  label: string;
  items: LoadItem[];
};

/** Monday of the ISO week containing `iso`, pinned to midday UTC so no zone's
    DST can shift the day underneath the subtraction. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  // getUTCDay(): Sunday is 0, and Sunday belongs to the week that STARTED six
  // days earlier — the off-by-one that makes a Sunday service jump a column.
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Weeks of workload ahead, plus an Overdue column pinned at the left.

    Anything before today lands in `overdue` regardless of its week — a
    service three days late and one three months late are the same kind of
    problem, and neither belongs on a forward-looking rail. Anything past the
    horizon is dropped rather than squashed into the last column, so the final
    week's height stays honest. */
export function weekBuckets(items: LoadItem[], today: string, weeks = 8): LoadBucket[] {
  const start = mondayOf(today);
  const buckets: LoadBucket[] = [{ key: "overdue", label: "Overdue", items: [] }];

  const weekStarts: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i * 7);
    const iso = d.toISOString().slice(0, 10);
    weekStarts.push(iso);
    buckets.push({ key: iso, label: i === 0 ? "This week" : i === 1 ? "Next week" : "", items: [] });
  }

  for (const item of items) {
    if (item.date < today) {
      buckets[0].items.push(item);
      continue;
    }
    // Index straight off the week offset — no scanning, and a date past the
    // horizon simply has no column to land in.
    const offset = Math.floor(daysUntil(mondayOf(item.date), start) / 7);
    if (offset >= 0 && offset < weeks) buckets[offset + 1].items.push(item);
  }

  return buckets;
}

/** The radar as timeline items — overdue is overdue, and anything not fully
    prepped shows amber so the humps you can still do something about stand
    out from the ones that are already sorted. */
export function radarLoad(radar: RadarItem[]): LoadItem[] {
  return radar.map((r) => ({
    id: r.visitId,
    date: r.dueDate,
    label: `${r.label} · ${r.clientName}`,
    state:
      r.bucket === "overdue" ? "overdue" : r.ready < r.readyTotal ? "attention" : "ready",
  }));
}

/* ── the project funnel ── */

export type StageColumn = {
  stage: string;
  items: ProjectStripItem[];
  /** Worst flag in the column — the funnel shows WHERE the trouble is, not
      just where the volume is. */
  tone: Tone;
};

/** Projects laid out across the pipeline, one column per stage.

    Deliberately NOT a week timeline: a project has no due date in the schema,
    only a stage and a checklist, so dates on this axis would be invented.
    Stage is the real axis — it answers "where does everything pile up", which
    is the same question the maintenance timeline answers about time. Every
    stage gets a column even when empty; the gaps are the point. */
export function stageFunnel(
  projects: ProjectStripItem[],
  stages: readonly string[],
  today: string
): StageColumn[] {
  return stages.map((stage) => {
    const items = projects.filter((p) => p.stage === stage);
    const tones = items.map((p) => projectFlag(p, today).tone);
    return {
      stage,
      items,
      tone: tones.includes("urgent") ? "urgent" : tones.includes("attention") ? "attention" : "calm",
    };
  });
}
