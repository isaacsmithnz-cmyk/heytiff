/* WATCHING HER BUILD IT (slice 5.2, mock-up screen 2): under the total while
   Tiff works, every part of the quote in the order she planned it (plan_parts),
   done with its price, the one she's on with how far through, and what's
   still to come. A part is a system's group: "Downstairs" + "Ductwork and
   grilles". She's on the furthest part that has lines; every part before it
   is done. Pure. */

export type PlannedPart = { system: string; group: string; detail: string };

export type BuildPart = PlannedPart & {
  state: "done" | "now" | "todo";
  /** its lines so far */
  items: number;
  /** what they sell for, ex GST, cents; null before it has any */
  sellCents: number | null;
};

export const MAX_PARTS = 20;

const key = (system: string, group: string) => `${system.trim().toLowerCase()}|${group.trim().toLowerCase()}`;

/** Her plan as she gave it, made safe. */
export function planOf(raw: unknown): PlannedPart[] {
  const list = Array.isArray(raw) ? raw : [];
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const seen = new Set<string>();
  const out: PlannedPart[] = [];
  for (const p of list) {
    const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const part = { system: text(o.system, 80), group: text(o.group, 80), detail: text(o.detail, 160) };
    if (!part.group || seen.has(key(part.system, part.group))) continue;
    seen.add(key(part.system, part.group));
    out.push(part);
    if (out.length === MAX_PARTS) break;
  }
  return out;
}

/** The plan against the option's lines as they stand. `sellOf` is a line's
    total sell, cents. */
export function buildProgress<L extends { system: string; group: string }>(plan: readonly PlannedPart[], lines: readonly L[], sellOf: (l: L) => number): { parts: BuildPart[]; done: number } {
  const by = new Map<string, L[]>();
  for (const l of lines) by.set(key(l.system, l.group), [...(by.get(key(l.system, l.group)) ?? []), l]);
  const has = plan.map((p) => (by.get(key(p.system, p.group)) ?? []).length > 0);
  const now = Math.max(0, has.lastIndexOf(true));
  const parts = plan.map((p, i): BuildPart => {
    const mine = by.get(key(p.system, p.group)) ?? [];
    return {
      ...p,
      state: i < now ? "done" : i === now ? "now" : "todo",
      items: mine.length,
      sellCents: mine.length ? mine.reduce((n, l) => n + sellOf(l), 0) : null,
    };
  });
  return { parts, done: Math.min(now, plan.length) };
}
