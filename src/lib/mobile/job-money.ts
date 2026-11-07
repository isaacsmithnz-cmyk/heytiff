import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { readJobLedger, resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { sm8CheckInLeftOpen, sm8MinutesBetween } from "@/lib/workboard/all-jobs";
import { readCheckInFixes, withFix } from "@/lib/workboard/check-in-fixes";
import { countedSessions } from "@/lib/workboard/job-check-ins";
import { readJobCheckInSessions } from "@/lib/workboard/job-check-ins-server";
import { jobMoneyOf } from "@/lib/workboard/job-money";
import { getSm8Timezone } from "@/lib/workboard/query";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { readLines } from "@/lib/quotes/lines-server";
import { byHandOf, optionNames } from "@/lib/quotes/lines-job";
import type { QuoteLine } from "@/lib/quotes/lines";
import { getPaySettings } from "@/lib/timepay/query";
import { DEFAULT_SUPER_PCT } from "@/lib/staff/my-pay";
import type { MobileCtx } from "./auth";

/* A JOB'S MONEY, ON THE PHONE (Isaac, 29 October 2026: "Build the rest",
   the overnight mock's job costing: "what it was quoted at, what the quote
   allowed at cost, and what's been spent so far"; and "I'm on a salary, so
   my overtime should count towards labour on a job for budgeting").

   QUOTED: ServiceM8's job value (inc GST) and its lines' own ex-GST
   figures added up, never GST worked out. Not HeyTiff's quote priced again:
   a quote's lines are priced as they stand today, not as it was sent.
   ALLOWED: HeyTiff's quote, the option the client took or the only one
   there is, its lines at cost, by kind: units, materials, and the
   labour's hours and cost. A quote with several options and none accepted
   allows nothing yet; a quote from before the lines engine has no costs.
   SO FAR, LABOUR: every counted hour on the job, the card's own rule
   (job-check-ins countedSessions: ServiceM8's check-ins, HeyTiff's winning
   a person's day), left-on check-ins shown and left out. All the hours a
   person worked go on the job, salaried or not; only pay follows the
   payslip. Costed at each person's wage plus super, where their card has a
   wage. SO FAR, MATERIALS: not read: an expense claim names a ServiceM8 job
   only in its words, so nothing here can add them up yet.

   Owners only: `workboard_money` to read it at all, and the cost of anyone's
   hour (a wage) only with `financials` too, as the Team cards keep it. */

/** The cents are null where an hour's or a part's cost isn't this person's to see. */
export type Allowed = { option: string; unitsCents: number | null; materialsCents: number | null; materialLines: number; labourHours: number; labourCents: number | null };
export type Worked = { key: string; name: string; minutes: number; costCents: number | null; days: { day: string; from: string; until: string; minutes: number }[] };
export type JobMoneyRead = {
  quoted: { incGstCents: number | null; exGstCents: number | null; options: number; option: string | null };
  allowed: Allowed | null;
  labour: { minutes: number; costCents: number | null; people: Worked[]; leftOn: number };
  /** whether the cost of an hour is shown at all */
  costs: boolean;
};

const UUID = /^[0-9a-f-]{36}$/i;
const low = (s: string) => s.toLowerCase();

/** The option the money is about: the one accepted, or the only one there is. Pure. */
export function pickOption(accepted: readonly number[], present: readonly number[]): number | null {
  const there = [...new Set(present)].sort((a, b) => a - b);
  const took = accepted.find((i) => there.includes(i));
  if (took !== undefined) return took;
  return there.length === 1 ? there[0]! : null;
}

/** One option's lines at cost, by kind. A labour line's quantity is hours. Pure. */
export function allowedOf(lines: readonly QuoteLine[], option: number, name: string): Allowed {
  const mine = lines.filter((l) => l.optionIndex === option);
  const cost = (k: QuoteLine["kind"]) => Math.round(mine.filter((l) => l.kind === k).reduce((s, l) => s + l.costCents * l.qty, 0));
  return {
    option: name,
    unitsCents: cost("unit"),
    materialsCents: cost("material"),
    materialLines: mine.filter((l) => l.kind === "material").length,
    labourHours: Math.round(mine.filter((l) => l.kind === "labour").reduce((s, l) => s + l.qty, 0) * 100) / 100,
    labourCents: cost("labour"),
  };
}

type Session = { start_date: string | null; end_date: string | null; staff_uuid: string | null; activity_was_scheduled: number | null };

/** Each person's counted time on the job, day by day, and how many check-ins
    were left on and can't be counted. `rate` is the cost of their hour in
    cents, or null. Pure. */
export function workedOf(sessions: readonly Session[], nameOf: (key: string) => string, rate: (key: string) => number | null): { people: Worked[]; leftOn: number } {
  const by = new Map<string, Worked>();
  let leftOn = 0;
  for (const s of sessions) {
    if (s.activity_was_scheduled !== 0 || !s.start_date || !s.end_date) continue;
    const m = sm8MinutesBetween(s.start_date, s.end_date);
    if (m === null || m <= 0) continue;
    if (sm8CheckInLeftOpen(s.start_date, s.end_date)) {
      leftOn++;
      continue;
    }
    const key = s.staff_uuid ? (UUID.test(s.staff_uuid) ? low(s.staff_uuid) : s.staff_uuid) : "";
    const w = by.get(key) ?? { key, name: nameOf(key), minutes: 0, costCents: null, days: [] };
    w.minutes += m;
    const day = s.start_date.slice(0, 10);
    const d = w.days.find((x) => x.day === day);
    if (d) {
      d.minutes += m;
      if (s.start_date < d.from) d.from = s.start_date;
      if (s.end_date > d.until) d.until = s.end_date;
    } else w.days.push({ day, from: s.start_date, until: s.end_date, minutes: m });
    by.set(key, w);
  }
  const people = [...by.values()].map((w) => {
    const r = rate(w.key);
    return { ...w, costCents: r === null ? null : Math.round((w.minutes / 60) * r), days: w.days.sort((a, b) => b.day.localeCompare(a.day)) };
  });
  return { people: people.sort((a, b) => b.minutes - a.minutes), leftOn };
}

/** The cost of a person's hour, cents: their wage plus super. Pure. */
export const hourCostCents = (wage: number | null, superPct: number) => (wage === null || !Number.isFinite(wage) || wage <= 0 ? null : Math.round(wage * 100 * (1 + superPct / 100)));

/** The option's allowance at cost, from HeyTiff's own quote; how many options it has. */
async function allowedFor(orgId: string, cardId: string): Promise<{ allowed: Allowed | null; options: number; option: string | null }> {
  const [lines, raw] = await Promise.all([readLines(orgId, cardId), supabaseAdmin.from("quote_drafts").select("draft, engine").eq("org_id", orgId).eq("sm8_job_uuid", cardId).maybeSingle()]);
  const row = raw.data as { draft: unknown; engine: string | null } | null;
  if (!row || row.engine !== "lines" || lines.length === 0) return { allowed: null, options: 0, option: null };
  const byHand = byHandOf(row.draft);
  const present = lines.map((l) => l.optionIndex);
  const picked = pickOption(byHand.accepted, present);
  const options = new Set(present).size;
  if (picked === null) return { allowed: null, options, option: null };
  const name = optionNames(row.draft, byHand)[picked]?.trim() || `Option ${picked + 1}`;
  return { allowed: allowedOf(lines, picked, name), options, option: name };
}

/** ServiceM8's lines, ex GST as it states them, added up; null when any can't be read. Pure. */
export const exGstOf = (lines: readonly { exLineCents?: number | null }[]): number | null =>
  lines.length === 0 || lines.some((l) => l.exLineCents == null) ? null : lines.reduce((s, l) => s + (l.exLineCents ?? 0), 0);

/** The job's money, for an owner on the phone. Null when the job isn't here. */
export async function readJobMoney(ctx: MobileCtx, jobId: string): Promise<JobMoneyRead | null> {
  const { parentRemoteId: cardId } = await resolveJobCard(ctx.orgId, jobId.trim().slice(0, 80));
  const { data: job } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, total_invoice_amount, invoice_sent, invoice_date, quote_sent, quote_sent_stamp, payment_received, payment_received_stamp")
    .eq("org_id", ctx.orgId)
    .eq("uuid", cardId)
    .maybeSingle();
  if (!job) return null;
  const costs = ctx.caps.has("financials");
  const tz = await getSm8Timezone(ctx.orgId).catch(() => null);

  const [quote, ledger, acts, ours, staff, links, profiles, pay] = await Promise.all([
    allowedFor(ctx.orgId, cardId),
    readJobLedger(ctx.orgId, cardId),
    supabaseAdmin.from("sm8_job_activities").select("uuid, start_date, end_date, staff_uuid, activity_was_scheduled").eq("org_id", ctx.orgId).eq("job_uuid", cardId).eq("activity_was_scheduled", 0).eq("active", 1),
    readJobCheckInSessions(ctx.orgId, cardId, tz, new Date()),
    supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", ctx.orgId),
    costs ? sm8StaffLinkMap(ctx.orgId) : Promise.resolve(new Map<string, string>()),
    costs ? supabaseAdmin.from("staff_profiles").select("id, user_id, hourly_wage, super_override").eq("org_id", ctx.orgId) : Promise.resolve({ data: [] }),
    costs ? getPaySettings(ctx.orgId) : Promise.resolve(null),
  ]);

  const actRows = (acts.data ?? []) as { uuid: string; start_date: string | null; end_date: string | null; staff_uuid: string | null; activity_was_scheduled: number | null }[];
  const fixes = await readCheckInFixes(ctx.orgId, actRows.map((a) => a.uuid));
  const sessions = countedSessions(
    actRows.map((a) => withFix(a, fixes)),
    ours.sessions,
  );

  const names = new Map<string, string>();
  for (const s of (staff.data ?? []) as { uuid: string; first: string | null; last: string | null }[]) names.set(low(s.uuid), [s.first, s.last].filter(Boolean).join(" ").trim() || "Someone");
  for (const [k, n] of ours.names) names.set(k, n);

  /* a person's hour: their card's wage plus super (theirs, else the business's, else the statutory rate) */
  const orgSuper = pay?.settings.superPct;
  const cards = (profiles.data ?? []) as { id: string; user_id: string | null; hourly_wage: number | string | null; super_override: number | string | null }[];
  const rateOfCard = new Map(
    cards.map((c) => {
      const own = c.super_override == null ? null : Number(c.super_override);
      const sup = own !== null && Number.isFinite(own) ? own : typeof orgSuper === "number" && Number.isFinite(orgSuper) ? orgSuper : DEFAULT_SUPER_PCT;
      return [c.id, hourCostCents(c.hourly_wage == null ? null : Number(c.hourly_wage), sup)];
    }),
  );
  const cardOfSm8 = new Map([...links].map(([remote, card]) => [low(remote), card]));
  const cardOfUser = new Map(cards.filter((c) => c.user_id).map((c) => [`hey:${c.user_id}`, c.id]));
  const rate = (key: string) => {
    if (!costs) return null;
    const card = cardOfSm8.get(key) ?? cardOfUser.get(key);
    return card ? (rateOfCard.get(card) ?? null) : null;
  };

  const worked = workedOf(sessions, (k) => names.get(k) ?? "Someone", rate);
  const minutes = worked.people.reduce((s, p) => s + p.minutes, 0);
  const priced = worked.people.filter((p) => p.costCents !== null);
  return {
    quoted: { incGstCents: jobMoneyOf(job).valueCents, exGstCents: exGstOf(ledger.materials), options: quote.options, option: quote.option },
    allowed: quote.allowed && !costs ? { ...quote.allowed, unitsCents: null, materialsCents: null, labourCents: null } : quote.allowed,
    labour: { minutes, costCents: costs && priced.length ? priced.reduce((s, p) => s + p.costCents!, 0) : null, people: worked.people, leftOn: worked.leftOn },
    costs,
  };
}
