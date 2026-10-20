import type { Hue } from "@/components/parts/state";
import type { AskEvent } from "./ask-client";
import type { KbCategory } from "./files";

/* CONVERSATIONS (v2, step 5; the board v2-board-conversations): the words
   and the times the place shows, kept pure so they can be proven without a
   screen. The place itself is components/conversations. */

/** The views of the list (rule 29): All, Team, Only me. */
export type ConvView = "all" | "team" | "me";

export const CONV_VIEWS: readonly { key: ConvView; label: string }[] = [
  { key: "all", label: "All" },
  { key: "team", label: "Team" },
  { key: "me", label: "Only me" },
];

export const viewOf = (v: unknown): ConvView => (v === "team" || v === "me" ? v : "all");

/** The view and the open thread or note, as the address carries them. */
export function withConvState(href: string, s: { view: ConvView; open: string | null }): string {
  const url = new URL(href);
  if (s.view === "all") url.searchParams.delete("view");
  else url.searchParams.set("view", s.view);
  if (s.open) url.searchParams.set("open", s.open);
  else url.searchParams.delete("open");
  return `${url.pathname}${url.search}${url.hash}`;
}

/* ── times ──────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Whole days between two moments, by the calendar: 0 today, 1 yesterday. */
export const daysAgo = (ts: number, now: number): number => Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);

/** "10:42 am" */
export const clockOf = (ts: number): string =>
  new Date(ts).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s+/g, " ").toLowerCase();

const weekday = (ts: number) => new Date(ts).toLocaleDateString("en-AU", { weekday: "long" });

const dayMonth = (ts: number, now: number) =>
  new Date(ts).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    ...(new Date(ts).getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });

/** The divider over a day's messages: Today, Yesterday, Friday, or Friday 10 October. */
export function dayLabel(ts: number, now: number): string {
  const n = daysAgo(ts, now);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 7) return weekday(ts);
  return `${weekday(ts)} ${dayMonth(ts, now)}`;
}

/** The grey line under a thread's title: Today 10:42 am, Yesterday, Friday, 10 October. */
export function threadWhen(ts: number, now: number): string {
  const n = daysAgo(ts, now);
  if (n <= 0) return `Today ${clockOf(ts)}`;
  if (n === 1) return "Yesterday";
  if (n < 7) return weekday(ts);
  return dayMonth(ts, now);
}

/** A key that is the same for every moment of one calendar day. */
export const dayKeyOf = (ts: number): number => startOfDay(ts);

/* ── what Tiff did, ticked in grey ──────────────────────────────────────── */

/* Her working steps come off the search's own report (the `trace` event),
   so a step is only ever something she did: how much of the library matched,
   and the documents she read first. Nothing is written to look busier. */
export function stepsFromTrace(trace: Extract<AskEvent, { t: "trace" }>): string[] {
  const cats = Object.values(trace.categories ?? {});
  const total = cats.reduce((n, c) => n + (c?.hits ?? 0), 0);
  if (total === 0) return [];
  const steps = [`Searched your library: ${total.toLocaleString("en-AU")} matching ${total === 1 ? "passage" : "passages"}`];
  for (const w of trace.winners.slice(0, 3)) {
    const doc = trace.categories[w]?.topDoc;
    const step = doc ? `Read ${doc}` : null;
    if (step && !steps.includes(step)) steps.push(step);
  }
  return steps;
}

export const MISS_STEP = "Searched your library: nothing in it covers this";

/* ── a library document's dot ───────────────────────────────────────────── */

/* The five kinds of document, in the eight (rule 15), snapped by hue from
   the colours the Library's rail still wears: installation's teal to green,
   service's blue, specs' amber to orange, SOPs' violet to purple. Field
   notes' cyan would snap to blue beside service's, so it takes grey. The
   dot always stands beside the kind's own word. */
const CATEGORY_HUE: Record<KbCategory, Hue> = {
  install: "green",
  faults: "blue",
  specs: "orange",
  sops: "purple",
  field: "grey",
};

export const categoryHue = (c: KbCategory): Hue => CATEGORY_HUE[c] ?? "grey";

/** A note's first line, as its title in the list. */
export function noteTitle(body: string): string {
  const first = body.trim().split("\n").find((l) => l.trim()) ?? "";
  return first.trim() || "Note";
}
