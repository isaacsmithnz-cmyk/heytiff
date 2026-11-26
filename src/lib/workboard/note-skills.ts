import { HHMM } from "@/lib/dashboard/reminders";
import { visitDay } from "./note-visit";

/* TIFF'S SKILLS — pure, on both sides of the wire.

   Isaac, 17 November 2026: "You can do 1, 2, 3. Six, 7, 8", then the
   evening's list, for the overnight build. Each is something a note can ask
   Tiff to DO that isn't a task, a visit, a cost or a variation: put the
   materials used on the job, your time on it, close it off, make a new job,
   block out an afternoon, ask for a photo next visit, book leave, log fuel,
   report a vehicle problem, keep a site note, add a contact, take stock out,
   add to the quote, swap who's on a visit.

   ONE LANE FOR THEM ALL. The proposal carries `skills`, a list of
   `{ kind, ... }`, so the plan's rows, the draft's crosses, the stored
   proposal and the record each grew once rather than once a skill. Each
   skill is its own small tool the router calls only when the note needs it
   (note-brain's `noteTools`), so adding one never grows what every note
   pays for.

   WHAT EACH DOES is the server's (note-skills-file), through the action the
   app already has for it: the phone's Used step, Add a job's time, Block
   out time, the job's Add task, Leave, Vehicles, Site notes, the quote's
   lines. This file holds what each one is, how its words are checked, the
   row Tiff shows, and the question it asks when a figure is missing.

   ASKED FIRST where ServiceM8 can't take it back: a job's status and a new
   job (`confirm`). Everything else files at once, with Undo. */

export const SKILL_KINDS = [
  "used",
  "time_on_job",
  "job_status",
  "new_job",
  "block_out",
  "photo_request",
  "leave",
  "fuel",
  "vehicle_issue",
  "site_note",
  "job_contact",
  "stock_taken",
  "quote_add",
  "swap_visit",
  "star_job",
] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];
export const isSkillKind = (v: unknown): v is SkillKind => (SKILL_KINDS as readonly unknown[]).includes(v);

export const JOB_STATUSES = ["completed", "work_order", "unsuccessful"] as const;
export type JobStatusTo = (typeof JOB_STATUSES)[number];
export const LEAVE_KINDS = ["annual", "sick", "personal", "unpaid"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];
export const DAY_PARTS = ["day", "morning", "afternoon"] as const;
export type DayPart = (typeof DAY_PARTS)[number];
export const LINE_KINDS = ["labour", "material"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** A line for the quote or a variation: "Allow 1 hour for the tap". */
export type SkillLine = { kind: LineKind; what: string; hours: number; qty: number };

/** One skill. `whoId` is the person it's for, resolved by the shaper:
    the speaker's own time, block or leave, or the person named. */
export type ProposedSkill = SkillBody & { whoId?: string | null };
type SkillBody =
  | { kind: "used"; what: string; qty: number; unit: string }
  | { kind: "time_on_job"; from: string; until: string }
  | { kind: "job_status"; to: JobStatusTo }
  | { kind: "new_job"; work: string; address: string; client: string; phone: string; email: string }
  | { kind: "block_out"; whoHint: string; day: string; start: string; end: string; what: string }
  | { kind: "photo_request"; what: string }
  | { kind: "leave"; whoHint: string; leave: LeaveKind; fromDay: string; toDay: string; part: DayPart; why: string }
  | { kind: "fuel"; vehicleHint: string; litres: number; amount: number; km: number; noReceipt: boolean }
  | { kind: "vehicle_issue"; vehicleHint: string; problem: string }
  | { kind: "site_note"; text: string }
  | { kind: "job_contact"; name: string; phone: string; email: string; role: string }
  | { kind: "stock_taken"; what: string; qty: number; from: string }
  | { kind: "quote_add"; what: string; lines: SkillLine[] }
  /* `fromId`: whose booking it is now, resolved like `whoId` (who takes it);
     null for the speaker's own */
  | { kind: "swap_visit"; booking: string; fromHint: string; toHint: string; day: string; fromId?: string | null }
  /** the speaker's star on this job (Isaac, 24 November 2026: "Star 3602 and remind me to contact them" stars it
      and adds the task; the task is the task lane's) */
  | { kind: "star_job"; on: boolean };

/** At most this many skills come off one note. */
export const SKILLS_MAX = 12;

/* ── the tools' schemas (note-brain's `noteTools`) ─────────────────────── */

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const en = (values: readonly string[]) => ({ type: "string", enum: [...values] }) as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const LINES_SCHEMA = {
  type: "array",
  items: obj({ kind: en(LINE_KINDS), what: str, hours: num, qty: num }),
} as const;

/** Each skill's tool: what it says it is, and one item's fields. Every
    field is required and "" or 0 says not-said, as in every lane. */
export const SKILL_TOOLS: Record<SkillKind, { description: string; item: ReturnType<typeof obj> }> = {
  used: {
    description: "Materials used on this job, from the van or the job's stock.",
    item: obj({ what: str, qty: num, unit: str }),
  },
  time_on_job: {
    description: "The speaker's own time on this job today, from and until.",
    item: obj({ from: str, until: str }),
  },
  job_status: {
    description: "Change this job's status: finished (completed), accepted (work_order) or lost (unsuccessful).",
    item: obj({ to: en(JOB_STATUSES) }),
  },
  new_job: {
    description: "A new job or lead to make, at another address or for a new client.",
    item: obj({ work: str, address: str, client: str, phone: str, email: str }),
  },
  block_out: {
    description: "Time someone is unavailable on the schedule for an appointment or errand, not leave.",
    item: obj({ who_hint: str, day: str, start: str, end: str, what: str }),
  },
  photo_request: {
    description: "A photo whoever goes next should take on this job.",
    item: obj({ what: str }),
  },
  leave: {
    description: "Leave or a sick day: annual, sick, personal or unpaid.",
    item: obj({ who_hint: str, leave: en(LEAVE_KINDS), from_day: str, to_day: str, part: en(DAY_PARTS), why: str }),
  },
  fuel: {
    description: "Fuel bought for a work vehicle, and the odometer.",
    item: obj({ vehicle_hint: str, litres: num, amount: num, km: num, no_receipt: { type: "boolean" } }),
  },
  vehicle_issue: {
    description: "A problem with a work vehicle.",
    item: obj({ vehicle_hint: str, problem: str }),
  },
  site_note: {
    description: "Something about the site to know next time: access, keys, dogs, parking, the switchboard.",
    item: obj({ text: str }),
  },
  job_contact: {
    description: "A person to add as a contact on this job.",
    item: obj({ name: str, phone: str, email: str, role: str }),
  },
  stock_taken: {
    description: "Stock taken from the store or a van for this job.",
    item: obj({ what: str, qty: num, from: str }),
  },
  quote_add: {
    description: "Work or materials to add to this job's quote before the client accepts it.",
    item: obj({ what: str, lines: LINES_SCHEMA }),
  },
  swap_visit: {
    description: "A booking someone already HAS, handed to another person: 'give my 2pm to Alex'. Never a new booking: putting someone onto a job at a time is a visit.",
    item: obj({ booking: str, from_hint: str, to_hint: str, day: str }),
  },
  star_job: {
    description: "Star this job for the speaker, to keep it in their Starred, or take its star off.",
    item: obj({ on: { type: "boolean" } }),
  },
};

/** What the router is told about the skills, after the lanes: one line
    each where its tool's own line isn't enough. */
export const SKILL_RULES = [
  "- used: materials used. `qty` the number said, else 0; `unit` m, each,",
  "  L or kg as said. 'About 14 metres of 3/8 5/8' is 14 m of 3/8 5/8 pair",
  "  coil. Not also a task or a progress bullet.",
  "- time_on_job: the speaker's own time on this job today, `from` and",
  "  `until` HH:MM as said ('8 till 11' is 08:00 to 11:00).",
  "- job_status: only when they ask for the job to be closed off, marked",
  "  finished, accepted or lost. 'Job's finished' alone is a progress bullet.",
  "- new_job: a different job to make ('the neighbour wants a quote').",
  "  Never this job. `client` the name, `phone` and `email` as said.",
  "  `address` the site's as said, a unit as 2/26 ('unit 2 of 26 Lorem",
  "  Street' is 2/26 Lorem Street), with its suburb; \"\" when none is said,",
  "  never a guess. Tiff looks the client up and the address on the map",
  "  herself before she offers the job, so 'see if we have her as a",
  "  customer' is no task. A reply that says yes to an address Tiff",
  "  offered ('is it 2/28 Lorem St?') makes that the `address`.",
  "- block_out: an appointment or errand that takes someone off the",
  "  schedule ('dentist Friday arvo'). `day` YYYY-MM-DD, `start` and `end`",
  "  HH:MM: 'arvo' is 12:00 to the end of their day, 'morning' the start of",
  "  their day to 12:00. Days off are leave, not a block.",
  "- photo_request: 'next time grab a photo of the switchboard'. Not also a task.",
  "- leave: whole days off. `to_day` the last day, the same as `from_day`",
  "  for one day; `part` morning or afternoon for half a day.",
  "- fuel: `amount` in dollars, `litres` and `km` (the odometer) as said,",
  "  else 0; `no_receipt` true only when they say there isn't one. Fuel is",
  "  never also a cost.",
  "- site_note: lasting facts about the place, not today's work.",
  "- quote_add and variations: `lines`, each labour (`hours`) or material",
  "  (`qty`), in the words said: 'allow 1 hour for the tap and 2 for the",
  "  fans, no materials' is two labour lines. quote_add is before the client",
  "  has accepted; a variation is after. Not also a task.",
  "- swap_visit: only a booking that is already someone's, handed over:",
  "  'give my 2pm to Alex', 'Luke takes Leo's Sampleton job today'. `booking`",
  "  the words naming which one, `from_hint` whose it is now (empty for the",
  "  speaker's), `to_hint` who takes it, `day` when. 'Put Alex onto the",
  "  Sampleco service call at 2', 'send Luke to 3239 tomorrow at 7' book",
  "  someone new: a visit, never a swap_visit.",
  "- star_job: 'star 3602', 'unstar it'. `on` false only to take the star",
  "  off. What they want done as well ('and remind me to call them') is a",
  "  task for the speaker, as ever.",
].join("\n");

/* ── the model's words, checked ────────────────────────────────────────── */

const text = (v: unknown, max = 200): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").slice(0, max) : "";
const amount = (v: unknown, max: number): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : 0;
const hhmm = (v: unknown): string => (typeof v === "string" && HHMM.test(v) ? v : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown, d: T): T => ((list as readonly unknown[]).includes(v) ? (v as T) : d);
const field = (r: Record<string, unknown>, snake: string, camel: string) => r[snake] ?? r[camel];

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Lines checked: a labour line needs hours, a material line a quantity
    (1 when none was said), and every line its words. */
export function linesOf(v: unknown): SkillLine[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): SkillLine[] => {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const what = text(r.what);
    if (!what) return [];
    const kind = oneOf(LINE_KINDS, r.kind, "labour");
    const hours = amount(r.hours, 200);
    if (kind === "labour" && !hours) return [];
    return [{ kind, what, hours: kind === "labour" ? hours : 0, qty: kind === "material" ? amount(r.qty, 10_000) || 1 : 0 }];
  }).slice(0, 20);
}

/** One skill, from the model's tool call (snake_case) or a stored proposal
    (camelCase); null when it says nothing it could do. */
export function skillFields(kind: SkillKind, r: Record<string, unknown>): ProposedSkill | null {
  switch (kind) {
    case "used": {
      const what = text(r.what);
      /* "each" is no unit: two wall brackets are "2" */
      const unit = text(r.unit, 12).replace(/^(?:each|ea|x|pcs?|items?|units?)$/i, "");
      return what ? { kind, what, qty: amount(r.qty, 10_000), unit } : null;
    }
    case "time_on_job": {
      const from = hhmm(r.from);
      const until = hhmm(r.until);
      return from && until && minutesOf(until) > minutesOf(from) ? { kind, from, until } : null;
    }
    case "job_status":
      return (JOB_STATUSES as readonly unknown[]).includes(r.to) ? { kind, to: r.to as JobStatusTo } : null;
    case "new_job": {
      const work = text(r.work, 300);
      const address = text(r.address, 200);
      return work || address
        ? { kind, work, address, client: text(r.client, 120), phone: text(r.phone, 40), email: text(r.email, 120) }
        : null;
    }
    case "block_out": {
      const day = visitDay(r.day);
      const start = hhmm(r.start);
      const end = hhmm(r.end);
      if (!day || !start || !end || minutesOf(end) <= minutesOf(start)) return null;
      return { kind, whoHint: text(field(r, "who_hint", "whoHint"), 80), day, start, end, what: text(r.what, 40) };
    }
    case "photo_request": {
      const what = text(r.what);
      return what ? { kind, what } : null;
    }
    case "leave": {
      const fromDay = visitDay(field(r, "from_day", "fromDay"));
      if (!fromDay) return null;
      const to = visitDay(field(r, "to_day", "toDay"));
      return {
        kind,
        whoHint: text(field(r, "who_hint", "whoHint"), 80),
        leave: oneOf(LEAVE_KINDS, r.leave, "annual"),
        fromDay,
        toDay: to && to >= fromDay ? to : fromDay,
        part: oneOf(DAY_PARTS, r.part, "day"),
        why: text(r.why, 200),
      };
    }
    case "fuel": {
      const litres = amount(r.litres, 500);
      const dollars = amount(r.amount, 2_000);
      const km = typeof r.km === "number" && r.km > 0 && r.km < 2_000_000 ? Math.round(r.km) : 0;
      if (!litres && !dollars && !km) return null;
      return {
        kind,
        vehicleHint: text(field(r, "vehicle_hint", "vehicleHint"), 80),
        litres,
        amount: dollars,
        km,
        noReceipt: field(r, "no_receipt", "noReceipt") === true,
      };
    }
    case "vehicle_issue": {
      const problem = text(r.problem, 500);
      return problem ? { kind, vehicleHint: text(field(r, "vehicle_hint", "vehicleHint"), 80), problem } : null;
    }
    case "site_note": {
      const t = text(r.text, 1000);
      return t ? { kind, text: t } : null;
    }
    case "job_contact": {
      const name = text(r.name, 120);
      const phone = text(r.phone, 40);
      const email = text(r.email, 120);
      return name && (phone || email || text(r.role)) ? { kind, name, phone, email, role: text(r.role, 60) } : name ? { kind, name, phone, email, role: "" } : null;
    }
    case "stock_taken": {
      const what = text(r.what);
      return what ? { kind, what, qty: amount(r.qty, 10_000) || 1, from: text(r.from, 80) } : null;
    }
    case "quote_add": {
      const lines = linesOf(r.lines);
      const what = text(r.what, 300) || lines.map((l) => l.what).join(", ");
      return lines.length ? { kind, what, lines } : null;
    }
    case "swap_visit": {
      const toHint = text(field(r, "to_hint", "toHint"), 80);
      return toHint
        ? { kind, booking: text(r.booking), fromHint: text(field(r, "from_hint", "fromHint"), 80), toHint, day: visitDay(r.day) }
        : null;
    }
    case "star_job":
      return { kind, on: r.on !== false };
  }
}

/** The skills from the model's calls, in the order they came. */
export function skillsFromCalls(calls: readonly { name: string; input: unknown }[]): ProposedSkill[] {
  const out: ProposedSkill[] = [];
  for (const { name, input } of calls) {
    if (!isSkillKind(name)) continue;
    const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    for (const item of Array.isArray(i.items) ? i.items : []) {
      const s = skillFields(name, (item && typeof item === "object" ? item : {}) as Record<string, unknown>);
      if (s && out.length < SKILLS_MAX) out.push(s);
    }
  }
  return out;
}

/** A stored proposal's `skills`, re-checked: one hand-edited or from an
    older shape is held to the same rules. */
export function skillsOf(raw: unknown): ProposedSkill[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const s = isSkillKind(r.kind) ? skillFields(r.kind, r) : null;
    if (!s) return [];
    const who = typeof r.whoId === "string" && r.whoId ? { ...s, whoId: r.whoId } : s;
    return [who.kind === "swap_visit" && typeof r.fromId === "string" && r.fromId ? { ...who, fromId: r.fromId } : who];
  });
}

/* ── the plan's row ────────────────────────────────────────────────────── */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Fri" for a day, "Fri 21 Nov" when `long`. */
export function shortDay(day: string, long = false): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!d) return "";
  const at = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3]));
  return long ? `${DAYS[at.getUTCDay()]} ${+d[3]} ${MONTHS[+d[2] - 1]}` : DAYS[at.getUTCDay()]!;
}
/** "8:00", "3:30" from "08:00", "15:30": the clock as the mock says it. */
export const clock = (t: string): string => {
  const h = Number(t.slice(0, 2));
  return `${h > 12 ? h - 12 : h}:${t.slice(3, 5)}`;
};
const qtyWords = (qty: number, unit: string) => (qty ? `${qty}${unit ? ` ${unit}` : ""}` : "");
const join = (...parts: string[]) => parts.filter(Boolean).join(", ");

export const STATUS_WORDS: Record<JobStatusTo, string> = {
  completed: "Completed",
  work_order: "Work Order",
  unsuccessful: "Unsuccessful",
};
const LEAVE_WORDS: Record<LeaveKind, string> = { annual: "annual leave", sick: "sick", personal: "personal leave", unpaid: "unpaid leave" };

/** Whether the skill waits on the person's say-so before it's done:
    ServiceM8 can't take a status or a new job back. */
export const confirms = (s: ProposedSkill): boolean => s.kind === "job_status" || s.kind === "new_job";

/** The row Tiff shows for a skill: who or what leads, and the rest.
    `who` is the first name of the person it's for, where a person leads. */
export function skillRow(s: ProposedSkill, who: string): { lead: string; text: string; needs: boolean } {
  switch (s.kind) {
    case "used":
      return { lead: "Used", text: s.qty ? join(s.what, qtyWords(s.qty, s.unit)) : `${s.what}, how many?`, needs: !s.qty };
    case "time_on_job":
      return { lead: who || "You", text: `on the job today, ${clock(s.from)} to ${clock(s.until)}`, needs: false };
    case "job_status":
      return { lead: "Job", text: STATUS_WORDS[s.to], needs: true };
    case "new_job":
      return { lead: "New job", text: join(s.work, s.address, s.client), needs: true };
    case "block_out":
      return { lead: who || s.whoHint || "You", text: join(`blocked out ${shortDay(s.day)} ${clock(s.start)} to ${clock(s.end)}`, s.what), needs: false };
    case "photo_request":
      return { lead: "Photo", text: `${s.what}, next visit`, needs: false };
    case "leave": {
      const days = s.toDay !== s.fromDay ? `${shortDay(s.fromDay, true)} to ${shortDay(s.toDay, true)}` : `${shortDay(s.fromDay, true)}${s.part !== "day" ? ` ${s.part}` : ""}`;
      return { lead: who || s.whoHint || "You", text: `${LEAVE_WORDS[s.leave]}, ${days}`, needs: false };
    }
    case "fuel":
      return {
        lead: "Fuel",
        text: join(s.vehicleHint, s.litres ? `${s.litres} L` : "", s.amount ? `$${s.amount.toFixed(2)}` : "", s.km ? `${s.km.toLocaleString("en-AU")} km` : ""),
        needs: !s.amount && !s.noReceipt,
      };
    case "vehicle_issue":
      return { lead: "Vehicle", text: join(s.vehicleHint, s.problem), needs: false };
    case "site_note":
      return { lead: "Site note", text: s.text, needs: false };
    case "job_contact":
      return { lead: "Contact", text: join(s.name, s.role, s.phone, s.email), needs: false };
    case "stock_taken":
      return { lead: "Stock", text: join(s.what, String(s.qty), s.from ? `from ${s.from}` : ""), needs: false };
    case "quote_add":
      return { lead: "Quote", text: join(s.what, linesWords(s.lines)), needs: false };
    case "swap_visit":
      return { lead: who || s.toHint, text: join(`takes ${s.fromHint ? `${s.fromHint}'s` : "your"} ${s.booking || "booking"}`, s.day ? shortDay(s.day) : ""), needs: false };
    case "star_job":
      return { lead: "Starred", text: s.on ? "added to your Starred" : "taken off your Starred", needs: false };
  }
}

/** "3 h labour" or "3 h labour, 2 materials": a line's sum, as a row says it. */
export function linesWords(lines: readonly SkillLine[]): string {
  const hours = lines.filter((l) => l.kind === "labour").reduce((n, l) => n + l.hours, 0);
  const mats = lines.filter((l) => l.kind === "material").length;
  return join(hours ? `${hours} h labour` : "", mats ? `${mats} ${mats === 1 ? "material" : "materials"}` : "");
}

/** The skill as the router is told it on a reply: what it already has. */
export function skillRowLine(s: ProposedSkill): string {
  const r = skillRow(s, "");
  return `${r.lead}: ${r.text}`;
}

/** The person a skill is for, as said: "" for the speaker. */
export const skillWho = (s: ProposedSkill): string =>
  s.kind === "block_out" || s.kind === "leave" ? s.whoHint : s.kind === "swap_visit" ? s.toHint : "";

/* ── what a skill became ──────────────────────────────────────────────── */

/** A skill a note did, as `workboard_notes.applied.skills` records it:
    what Tiff said, and how Undo takes it back. `undo` is the server's own
    (note-skills-file); null when nothing here can take it back. */
export type SkillMade = {
  index: number;
  kind: SkillKind;
  line: string;
  undo: { do: string; [k: string]: unknown } | null;
  /** Where what it made opens, when it has a page. */
  open?: string;
  undone: boolean;
};

export function skillsMadeOf(raw: unknown): SkillMade[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): SkillMade[] => {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (!Number.isInteger(r.index) || !isSkillKind(r.kind)) return [];
    const u = r.undo && typeof r.undo === "object" && typeof (r.undo as Record<string, unknown>).do === "string" ? (r.undo as SkillMade["undo"]) : null;
    return [
      {
        index: r.index as number,
        kind: r.kind,
        line: typeof r.line === "string" ? r.line : "",
        undo: u,
        ...(typeof r.open === "string" && r.open.startsWith("/") ? { open: r.open } : {}),
        undone: r.undone === true,
      },
    ];
  });
}

/** Its skills done and not taken back since, that Undo can take back. */
export const skillsToTakeBack = (made: readonly SkillMade[]): SkillMade[] => made.filter((m) => !m.undone && !!m.undo);

/* ── what's asked first ───────────────────────────────────────────────── */

/** The question a skill short of something asks before anything is filed:
    how many were used, or the fuel receipt. Null when it has what it needs. */
export function skillGap(s: ProposedSkill): string | null {
  if (s.kind === "used" && !s.qty) return `How many ${s.what}${s.unit ? ` (${s.unit})` : ""} did you use?`;
  if (s.kind === "fuel" && !s.noReceipt && !s.amount) return FUEL_RECEIPT;
  return null;
}
export const FUEL_RECEIPT = "Send me a photo of the fuel receipt.";
export const NO_RECEIPT = "No receipt";

/** The question a skill asked first puts, with its two answers. */
export function confirmAsk(s: ProposedSkill, job: string): { question: string; yes: string; no: string } | null {
  if (s.kind === "job_status") {
    const on = job ? ` ${job}` : " the job";
    return { question: `Mark${on} ${STATUS_WORDS[s.to]}?`, yes: `Mark it ${STATUS_WORDS[s.to]}`, no: "Leave it" };
  }
  if (s.kind === "new_job") {
    return { question: `Make the job${s.address ? ` at ${s.address}` : ""} in ServiceM8?`, yes: "Make the job", no: "Not now" };
  }
  return null;
}
