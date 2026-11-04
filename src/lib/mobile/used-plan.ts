/* WHAT WAS USED ON A JOB TODAY, the shared list's rules (Isaac, 3 November
   2026: "if you've got three guys doing the same job and they all decide to
   do their daily wrap-up at the same time, who decides?"). One list per job
   per day (job_materials_used). The next person sees it and adds what's
   missing; something already on it gets a question instead of a second
   line: the same, in total, more on top, or leave it. "Not sure, leave it"
   keeps the first figure, orange until someone settles it. Every line keeps
   who said what. Pure: used.ts reads and writes. */

export type Choice = { supplierKey: string; code: string; name: string; hint: string };

/** One thing said, found in the price book or not, ready to go on the list. */
export type Found = {
  /** their words for it */
  said: string;
  name: string;
  /** null when no count was said ("some wall brackets"): the phone asks How many? */
  qty: number | null;
  unit: string | null;
  supplierKey: string | null;
  code: string | null;
  /** the book's items it could be, when the words fit more than one */
  choices: Choice[] | null;
};

export type StepKind = "said" | "total" | "more" | "agreed" | "open" | "amount" | "picked" | "off";
/** One change to a line, as kept in its history. `by` is the auth user id. */
export type Step = { at: string; by: string; staff: string | null; kind: StepKind; qty: number; was?: number; said?: number; item?: string };
export type OpenRepeat = { by: string; staff: string | null; qty: number; at: string };

/** A line as job_materials_used keeps it. */
export type UsedRow = {
  id: string;
  sm8_job_uuid: string;
  day: string;
  supplier_key: string | null;
  code: string | null;
  name: string;
  qty: number | string;
  unit: string | null;
  choices: unknown;
  added_by: string;
  added_by_staff: string | null;
  words: string;
  open_repeat: unknown;
  history: unknown;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** How a repeat is settled: the figure said is the total, it's more on top, the one there stands, or nobody's sure. */
export type Settle = "total" | "more" | "leave" | "open";

export const UNITS = ["m", "roll", "box", "pack", "tube", "can", "bag", "L", "kg", "sheet"] as const;
/** A unit as said, or null for a count. */
export const unitOf = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const u = raw.trim();
  return (UNITS as readonly string[]).find((x) => x.toLowerCase() === u.toLowerCase()) ?? null;
};

/** The most a line can hold: a typo'd 6000 m is caught here, not on the tracker. */
export const MOST_QTY = 9999;
export const qtyOf = (raw: unknown): number | null => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MOST_QTY) return null;
  return Math.round(n * 1000) / 1000;
};

/** The same key the table's item_key column makes: the book's item, else the name. */
export const keyOf = (l: { supplierKey: string | null; code: string | null; name: string }) =>
  l.supplierKey && l.code ? `${l.supplierKey}|${l.code}` : `name:${l.name.trim().toLowerCase()}`;
export const keyOfRow = (r: Pick<UsedRow, "supplier_key" | "code" | "name">) => keyOf({ supplierKey: r.supplier_key, code: r.code, name: r.name });

/** A said thing that can go on the list as it is: a name and a count. */
export type Ready = Found & { qty: number };

/** What an Add does to the list as it stands: the new ones go on, a repeat of a line already there is asked about.
    Two of the same thing in one Add are one line, their figures together. */
export function planAdd(live: readonly UsedRow[], found: readonly Ready[]): { add: Ready[]; asks: { row: UsedRow; said: number }[] } {
  const merged = new Map<string, Ready>();
  for (const f of found) {
    const k = keyOf(f);
    const had = merged.get(k);
    merged.set(k, had ? { ...had, qty: Math.round((had.qty + f.qty) * 1000) / 1000, said: `${had.said}, ${f.said}` } : f);
  }
  const byKey = new Map(live.filter((r) => !r.removed_at).map((r) => [keyOfRow(r), r]));
  const add: Ready[] = [];
  const asks: { row: UsedRow; said: number }[] = [];
  for (const [k, f] of merged) {
    const row = byKey.get(k);
    if (row) asks.push({ row, said: f.qty });
    else add.push(f);
  }
  return { add, asks };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
export const stepsOf = (raw: unknown): Step[] => (Array.isArray(raw) ? (raw as Step[]).filter((s) => s && typeof s.at === "string" && typeof s.kind === "string") : []);
export const openOf = (raw: unknown): OpenRepeat | null => {
  const o = raw as OpenRepeat | null;
  return o && typeof o.qty === "number" && typeof o.by === "string" ? o : null;
};

type Who = { by: string; staff: string | null; at: string };

/** A repeat settled: the line's figure, its history and whether one is still open. */
export function settle(row: UsedRow, said: number, how: Settle, who: Who): { qty: number; history: Step[]; open_repeat: OpenRepeat | null } {
  const had = Number(row.qty);
  const history = stepsOf(row.history);
  const step = (kind: StepKind, qty: number, more: Partial<Step> = {}): Step => ({ at: who.at, by: who.by, staff: who.staff, kind, qty, ...more });
  if (how === "open") return { qty: had, history: [...history, step("open", had, { said })], open_repeat: { by: who.by, staff: who.staff, qty: said, at: who.at } };
  if (how === "leave") return { qty: had, history: [...history, step("agreed", had, { said })], open_repeat: null };
  const qty = how === "more" ? round(had + said) : said;
  if (qty === had) return { qty, history: [...history, step("agreed", had, { said })], open_repeat: null };
  return { qty, history: [...history, step(how, qty, { was: had, said })], open_repeat: null };
}

/** A line's figure changed by hand, from its own screen. */
export function amount(row: UsedRow, qty: number, who: Who): { qty: number; history: Step[]; open_repeat: OpenRepeat | null } {
  const had = Number(row.qty);
  return { qty, history: [...stepsOf(row.history), { at: who.at, by: who.by, staff: who.staff, kind: "amount", qty, was: had }], open_repeat: null };
}

/* ---- the line as the phone shows it ---- */

export type StepView = { at: string; by: string; mine: boolean; kind: StepKind; qty: number; was: number | null; said: number | null; item: string | null };
export type UsedLine = {
  id: string;
  name: string;
  qty: number;
  unit: string | null;
  /** matched to the price book */
  matched: boolean;
  choices: Choice[] | null;
  /** a different figure nobody settled: who said it and what */
  open: { by: string; mine: boolean; qty: number } | null;
  steps: StepView[];
  at: string;
};

/** A repeat to ask about: the line there, who has it and the figure just said. */
export type Ask = { lineId: string; name: string; unit: string | null; had: number; by: string; mine: boolean; said: number };

const choicesOf = (raw: unknown): Choice[] | null =>
  Array.isArray(raw) && raw.length ? (raw as Choice[]).filter((c) => c && typeof c.code === "string" && typeof c.name === "string") : null;

/** A line for the phone: names in place of ids, yours marked. `names` maps an auth user id to a first name. */
export function viewOf(row: UsedRow, names: ReadonlyMap<string, string>, me: string): UsedLine {
  const name = (by: string) => names.get(by) ?? "Someone";
  const steps = stepsOf(row.history).map((s) => ({ at: s.at, by: name(s.by), mine: s.by === me, kind: s.kind, qty: s.qty, was: s.was ?? null, said: s.said ?? null, item: s.item ?? null }));
  const open = openOf(row.open_repeat);
  return {
    id: row.id,
    name: row.name,
    qty: Number(row.qty),
    unit: row.unit,
    matched: !!(row.supplier_key && row.code),
    choices: row.supplier_key ? null : choicesOf(row.choices),
    open: open ? { by: name(open.by), mine: open.by === me, qty: open.qty } : null,
    steps,
    at: row.created_at,
  };
}

export function askOf(row: UsedRow, said: number, names: ReadonlyMap<string, string>, me: string): Ask {
  return { lineId: row.id, name: row.name, unit: row.unit, had: Number(row.qty), by: names.get(row.added_by) ?? "Someone", mine: row.added_by === me, said };
}

/** Every auth user id a set of lines names, for one read of their first names. */
export function peopleOf(rows: readonly UsedRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    out.add(r.added_by);
    for (const s of stepsOf(r.history)) out.add(s.by);
    const o = openOf(r.open_repeat);
    if (o) out.add(o.by);
  }
  return [...out];
}

/* ---- finding what was said in the price book ---- */

/** A book item as the matcher weighs it. */
export type Candidate = { supplierKey: string; code: string; name: string; uom: string | null; timesBought: number | null; preferred: boolean };

/** The book's items a search found, one per code (the same model at two
    suppliers is one): the business's preferred first, then the most
    bought, then the shortest name. */
export function rankCandidates(items: readonly Candidate[], most = 15): Candidate[] {
  const better = (a: Candidate, b: Candidate) =>
    Number(b.preferred) - Number(a.preferred) || (b.timesBought ?? 0) - (a.timesBought ?? 0) || a.name.length - b.name.length || a.code.localeCompare(b.code);
  const byCode = new Map<string, Candidate>();
  for (const c of items) {
    const had = byCode.get(c.code);
    if (!had || better(c, had) < 0) byCode.set(c.code, c);
  }
  return [...byCode.values()].sort(better).slice(0, most);
}

/** One thing said, read: its words, a plain name, the count (0 when none was said), the unit, and what to look for. */
export type Thing = { said: string; name: string; qty: number; unit: string; search: string[] };
/** The model's answer for one thing: the candidate it is, or the ones it could be. */
export type BookPick = { pick: number; choices: { index: number; hint: string }[] };

/** A thing said, as the list takes it, from what the book had and what was picked. */
export function foundOf(t: Thing, candidates: readonly Candidate[], p: BookPick | undefined): Found {
  const base = { said: t.said.trim(), qty: qtyOf(t.qty), unit: unitOf(t.unit) };
  const hit = p && p.pick >= 0 ? candidates[p.pick] : undefined;
  if (hit) return { ...base, name: hit.name, supplierKey: hit.supplierKey, code: hit.code, choices: null };
  const choices = (p?.choices ?? [])
    .map((c) => ({ c: candidates[c.index], hint: typeof c.hint === "string" ? c.hint.trim().slice(0, 60) : "" }))
    .filter((x): x is { c: Candidate; hint: string } => !!x.c)
    .filter((x, i, all) => all.findIndex((y) => y.c.code === x.c.code) === i)
    .slice(0, 4)
    .map(({ c, hint }) => ({ supplierKey: c.supplierKey, code: c.code, name: c.name, hint }));
  /* one choice is the pick */
  if (choices.length === 1) return { ...base, name: choices[0]!.name, supplierKey: choices[0]!.supplierKey, code: choices[0]!.code, choices: null };
  return { ...base, name: t.name.trim() || t.said.trim(), supplierKey: null, code: null, choices: choices.length ? choices : null };
}

/** A day the list may be kept for: the phone's own, from two weeks back to tomorrow on the account's clock. */
export function dayAllowed(day: unknown, today: string): day is string {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const at = Date.parse(`${day}T12:00:00Z`);
  const t = Date.parse(`${today}T12:00:00Z`);
  return Number.isFinite(at) && at <= t + 86_400_000 && at >= t - 14 * 86_400_000;
}

/** The first day a list may still be changed, two weeks back from today. */
export const changeFrom = (today: string) => new Date(Date.parse(`${today}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);

/* ---- the job across its trips (Isaac, 4 November 2026: "How does used
   work across multiple trips"; then "That's good" to the mock: today's list
   first, then each earlier trip under its date and who was there, then what
   the job has used so far) ---- */

/** An earlier trip's list: its day, the people who put things on it, and its lines. */
export type UsedTrip = { day: string; people: string[]; lines: UsedLine[] };
/** One thing across every trip: the amounts added up, and the days it was used on. */
export type UsedTotal = { key: string; name: string; unit: string | null; qty: number; days: string[] };

/** Every trip's list but today's, newest first, and the job so far, today's included. The same thing in
    another unit stays its own line: 6 m and 2 lengths don't add. */
export function tripsOf(rows: readonly UsedRow[], names: ReadonlyMap<string, string>, me: string, today: string): { trips: UsedTrip[]; total: UsedTotal[] } {
  const live = rows.filter((r) => !r.removed_at).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const byDay = new Map<string, UsedRow[]>();
  for (const r of live) if (r.day !== today) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  const trips = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, rs]) => ({ day, people: [...new Set(rs.map((r) => names.get(r.added_by) ?? "Someone"))], lines: rs.map((r) => viewOf(r, names, me)) }));
  const totals = new Map<string, UsedTotal>();
  for (const r of live) {
    const key = `${keyOfRow(r)}|${r.unit ?? ""}`;
    const had = totals.get(key);
    if (!had) totals.set(key, { key, name: r.name, unit: r.unit, qty: round(Number(r.qty)), days: [r.day] });
    else totals.set(key, { ...had, name: r.name, qty: round(had.qty + Number(r.qty)), days: had.days.includes(r.day) ? had.days : [...had.days, r.day].sort() });
  }
  return { trips, total: [...totals.values()] };
}
