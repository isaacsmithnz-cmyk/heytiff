import { splitDay, type Settings } from "@/components/timepay/logic";
import { fmtAud } from "@/lib/workboard/project-money";
import type { Tone } from "@/components/parts/state";

/* THE JOB TRACKER'S FIGURES (Isaac, 3 November 2026: "Record actual hours,
   then overtime rates to show. We may have got the hours right, but the
   timing off. Having to work on a Saturday can make you miss target
   easily"). Pure, so the route and the tests read one rule.

   LABOUR: the hours worked (the card's own count, job-money's workedOf),
   against the quote's hours. Each person's day is also paid as the
   business's pay settings say (timepay's splitDay: Saturday, Sunday, and
   past the day's overtime point), and the extra paid hours follow on the
   bar in orange. Only what the paid hours pass the quote by is red.
   MATERIALS: what was said used on the job (job_materials_used), priced
   from the price book at cost, against the quote's materials at cost.
   EQUIPMENT: the quote's units, at cost, as quoted. */

export type TrackerItem = { name: string; detail: string | null; amount: string | null; noPrice?: boolean };
export type TrackerDay = { day: string; who: string; hours: number; paidAs: number | null };
export type TrackerRead = {
  labour: { quotedHours: number | null; workedHours: number; paidHours: number; days: TrackerDay[]; leftOn: number };
  /** cents, at cost; null where the reader doesn't see costs */
  materials: { allowance: number | null; spent: number | null; unpriced: number; count: number; items: TrackerItem[] };
  equipment: { total: number | null; items: TrackerItem[] };
};

type Part = { kind: "used" | "ot" | "over"; share: number };
export type TrackerLook = { tone: Tone; word: string; parts: Part[]; label: string; under: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hours as the trade says them: 28 h, 42.5 h, 95.25 h. */
export const fmtHours = (h: number) => `${r2(h)} h`;

/** A day as the tracker names it: "Sat 31 Oct". `day` is YYYY-MM-DD. */
export function dayName(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(/,/g, "");
}

/** Monday 0 … Sunday 6, as timepay counts them. */
export const dowOfDay = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

/** One person's day, in hours, paid as the pay settings say. Pure. */
export function paidHours(hours: number, day: string, s: Settings): number {
  const sp = splitDay(r2(hours), dowOfDay(day), s);
  return r2(sp.n + sp.o15 * 1.5 + sp.o2 * 2);
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The days worked, newest first, each with who, the hours, and what they
    were paid as when that's more. Pure. */
export function labourDays(
  people: readonly { name: string; days: readonly { day: string; minutes: number }[] }[],
  s: Settings,
): { days: TrackerDay[]; worked: number; paid: number } {
  const by = new Map<string, { who: string[]; hours: number; paid: number }>();
  for (const p of people) {
    for (const d of p.days) {
      const h = d.minutes / 60;
      const e = by.get(d.day) ?? { who: [], hours: 0, paid: 0 };
      e.who.push(firstName(p.name));
      e.hours += h;
      e.paid += paidHours(h, d.day, s);
      by.set(d.day, e);
    }
  }
  const days = [...by.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, e]) => ({ day: dayName(day), who: andList(e.who), hours: r2(e.hours), paidAs: r2(e.paid) > r2(e.hours) ? r2(e.paid) : null }));
  return { days, worked: r2([...by.values()].reduce((a, e) => a + e.hours, 0)), paid: r2([...by.values()].reduce((a, e) => a + e.paid, 0)) };
}

/** Labour's word, bar and line under it. Pure. */
export function trackerLabour(l: TrackerRead["labour"]): TrackerLook {
  const w = l.workedHours;
  const p = Math.max(l.paidHours, w);
  const extra = r2(p - w);
  const under = extra > 0 ? `Overtime adds ${fmtHours(extra)}, paid as ${fmtHours(p)}` : null;
  const q = l.quotedHours;
  if (q === null || q <= 0) return { tone: "info", word: "No hours quoted", parts: [], label: `Labour: ${fmtHours(w)} worked`, under };
  const scale = Math.max(q, p);
  if (p > q) {
    const parts: Part[] = [
      { kind: "used", share: Math.min(w, q) / scale },
      { kind: "ot", share: Math.max(0, q - w) / scale },
      { kind: "over", share: (p - q) / scale },
    ];
    return { tone: "wrong", word: `${fmtHours(p - q)} over`, parts, label: `Labour: ${fmtHours(w)} worked, paid as ${fmtHours(p)}, ${fmtHours(p - q)} past ${fmtHours(q)}`, under };
  }
  return {
    tone: "good",
    word: `${fmtHours(q - p)} left`,
    parts: [
      { kind: "used", share: w / scale },
      { kind: "ot", share: extra / scale },
    ],
    label: `Labour: ${fmtHours(w)} worked of ${fmtHours(q)}`,
    under,
  };
}

/** Materials' word and bar. Pure. */
export function trackerMaterials(m: TrackerRead["materials"]): TrackerLook {
  const under = m.unpriced > 0 ? `${m.unpriced} without a price` : null;
  if (m.spent === null) return { tone: "info", word: m.count ? "As used" : "Nothing yet", parts: [], label: `Materials: ${m.count} used`, under: null };
  const a = m.allowance;
  if (a === null || a <= 0) return { tone: "info", word: "Not on the quote", parts: [], label: `Materials: ${fmtAud(m.spent)} used`, under };
  const s = m.spent;
  if (s > a) {
    return {
      tone: "wrong",
      word: `${fmtAud(s - a)} over`,
      parts: [
        { kind: "used", share: a / s },
        { kind: "over", share: (s - a) / s },
      ],
      label: `Materials: ${fmtAud(s)} of ${fmtAud(a)}, ${fmtAud(s - a)} over`,
      under,
    };
  }
  return { tone: "good", word: `${fmtAud(a - s)} left`, parts: [{ kind: "used", share: s / a }], label: `Materials: ${fmtAud(s)} of ${fmtAud(a)}`, under };
}

/** A quantity as said: "0.5 roll", "25 m", "3 used". */
export function qtyWord(qty: number, unit: string | null): string {
  const q = Math.round(qty * 1000) / 1000;
  return unit ? `${q} ${unit}` : `${q} used`;
}
