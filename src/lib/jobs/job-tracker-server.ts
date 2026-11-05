import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Capability } from "@/lib/permissions";
import type { MobileCtx } from "@/lib/mobile/auth";
import { pickOption, readJobMoney } from "@/lib/mobile/job-money";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { quotePlan } from "@/lib/workboard/visit-tasks-server";
import { readLines } from "@/lib/quotes/lines-server";
import { byHandOf } from "@/lib/quotes/lines-job";
import { bookProducts } from "@/lib/quotes/book-view-server";
import { bookPrice } from "@/lib/quotes/session/tools";
import { getPaySettings } from "@/lib/timepay/query";
import { fmtAud } from "@/lib/workboard/project-money";
import { readOrgDay } from "@/lib/quotes/org-day-server";
import { cleanVisits, dayName, labourDays, planHours, qtyWord, type PlanVisit, type TrackerItem, type TrackerRead } from "./job-tracker";

/* THE JOB TRACKER'S READ (job-tracker.ts has the rules). Labour comes from
   job-money's count of the job's hours, the phone's own, so the two never
   tell two stories; the quote's hours are its accepted option's labour
   lines, else what the quote plan gives (the brief's hours or its days).
   Materials are job_materials_used, read only: the phone's wrap-up writes
   that table and nothing here does. Costs (every dollar figure here is at
   cost) only for whoever holds `financials`. Null when the job isn't here.
   Where the quote holds no hours or no materials, job_tracker_plans may:
   what someone who sees money added by hand (savePlan below). */

type PlanRow = {
  visits: unknown;
  day_hours: number | string | null;
  hours_by_name: string | null;
  materials_cents: number | string | null;
  materials_by_name: string | null;
};

const firstOf = (n: string | null) => (n ?? "").trim().split(/\s+/)[0] || null;

type UsedRow = { day: string; supplier_key: string | null; code: string | null; name: string; qty: number | string; unit: string | null };

export async function readJobTracker(orgId: string, caps: ReadonlySet<Capability>, jobId: string): Promise<TrackerRead | null> {
  const ctx = { userId: "", orgId, role: null, caps: new Set(caps), orgIds: [orgId] } satisfies MobileCtx;
  const money = await readJobMoney(ctx, jobId);
  if (!money) return null;
  const { parentRemoteId: cardId } = await resolveJobCard(orgId, jobId.trim().slice(0, 80));
  const costs = caps.has("financials");

  const [plan, pay, used, lines, draft, products, planRow, day] = await Promise.all([
    money.allowed && money.allowed.labourHours > 0 ? Promise.resolve(null) : quotePlan(orgId, cardId).catch(() => null),
    getPaySettings(orgId),
    supabaseAdmin
      .from("job_materials_used")
      .select("day, supplier_key, code, name, qty, unit")
      .eq("org_id", orgId)
      .in("sm8_job_uuid", [...new Set([cardId, cardId.toLowerCase(), cardId.toUpperCase()])])
      .is("removed_at", null)
      .limit(1000),
    readLines(orgId, cardId).catch(() => []),
    supabaseAdmin.from("quote_drafts").select("draft, engine").eq("org_id", orgId).eq("sm8_job_uuid", cardId).maybeSingle(),
    costs ? bookProducts(orgId).catch(() => []) : Promise.resolve([]),
    supabaseAdmin
      .from("job_tracker_plans")
      .select("visits, day_hours, hours_by_name, materials_cents, materials_by_name")
      .eq("org_id", orgId)
      .eq("sm8_job_uuid", cardId)
      .maybeSingle(),
    readOrgDay(orgId).catch(() => null),
  ]);
  const pr = (planRow.data ?? null) as PlanRow | null;

  /* LABOUR */
  const fromQuote = money.allowed && money.allowed.labourHours > 0 ? money.allowed.labourHours : (plan?.hours ?? null);
  const planVisits = pr?.visits ? cleanVisits(pr.visits) : null;
  const planDay = pr?.day_hours != null ? Number(pr.day_hours) : null;
  const hoursPlan = fromQuote === null && planVisits?.length && planDay ? { visits: planVisits, dayHours: planDay, by: firstOf(pr!.hours_by_name) } : null;
  const quotedHours = fromQuote ?? (hoursPlan ? planHours(hoursPlan.visits, hoursPlan.dayHours) : null);
  const lab = labourDays(money.labour.people, pay.settings);

  /* MATERIALS: each thing added up across its days, in the unit it was said in */
  const rows = (used.data ?? []) as UsedRow[];
  const things = new Map<string, { name: string; code: string | null; supplier: string | null; unit: string | null; qty: number; days: string[] }>();
  for (const r of rows) {
    const key = `${(r.supplier_key ?? "").toLowerCase()}|${(r.code ?? r.name).toLowerCase()}|${r.unit ?? ""}`;
    const t = things.get(key) ?? { name: r.name, code: r.code, supplier: r.supplier_key, unit: r.unit, qty: 0, days: [] };
    t.qty += Number(r.qty) || 0;
    if (!t.days.includes(r.day)) t.days.push(r.day);
    things.set(key, t);
  }
  let spent = 0;
  let unpriced = 0;
  const matItems: TrackerItem[] = [...things.values()].map((t) => {
    const detail = `${qtyWord(t.qty, t.unit)}, ${t.days.sort().map(dayName).join(", ")}`;
    if (!costs) return { name: t.name, detail, amount: null };
    const p = t.code ? bookPrice(products, t.code, t.unit === "m" ? "m" : "", t.supplier) : null;
    if (!p) {
      unpriced++;
      return { name: t.name, detail, amount: null, noPrice: true };
    }
    const cents = Math.round(p.costCents * t.qty);
    spent += cents;
    return { name: t.name, detail, amount: fmtAud(cents) };
  });

  /* EQUIPMENT: the quote's units, from the option the money is about */
  const row = draft.data as { draft: unknown; engine: string | null } | null;
  const picked = row?.engine === "lines" && lines.length ? pickOption(byHandOf(row.draft).accepted, lines.map((l) => l.optionIndex)) : null;
  const units = picked === null ? [] : lines.filter((l) => l.optionIndex === picked && l.kind === "unit");
  const eqItems: TrackerItem[] = units.map((u) => ({
    name: u.code || u.name,
    detail: [u.code ? u.name : null, u.qty > 1 ? `${u.qty} of them` : null].filter(Boolean).join(", ") || null,
    amount: costs ? fmtAud(Math.round(u.costCents * u.qty)) : null,
  }));

  /* the quote's materials, else what was added by hand */
  const quoteMaterials = money.allowed?.materialsCents && money.allowed.materialsCents > 0 ? money.allowed.materialsCents : null;
  const planCents = quoteMaterials === null && pr?.materials_cents != null ? Number(pr.materials_cents) : null;

  return {
    labour: {
      quotedHours,
      workedHours: lab.worked,
      paidHours: lab.paid,
      days: lab.days,
      leftOn: money.labour.leftOn,
      canPlan: fromQuote === null,
      plan: hoursPlan,
      dayHours: day?.hours?.hours ?? null,
    },
    materials: {
      allowance: costs ? (quoteMaterials ?? planCents) : null,
      canPlan: costs && quoteMaterials === null,
      plan: costs && planCents !== null ? { by: firstOf(pr!.materials_by_name) } : null,
      spent: costs ? spent : null,
      unpriced,
      count: things.size,
      items: matItems,
    },
    equipment: { total: units.length ? (costs ? (money.allowed?.unitsCents ?? null) : null) : null, items: eqItems },
  };
}

export type PlanChange = {
  /** the visits as priced; an empty list takes the hours back off */
  visits?: unknown;
  /** the working day typed with them, used only where the business has none */
  dayHours?: unknown;
  /** cents at cost; null takes the materials back off */
  materialsCents?: unknown;
};

/** Add, change or take off what a job was priced at where its quote doesn't
    say. Only what the change names is touched. The working day is the
    business's at the time (its quoting settings, else its Rate Calculator),
    else the one typed with it, and it's kept with the visits. */
export async function savePlan(
  orgId: string,
  jobId: string,
  who: { id: string; name: string | null },
  change: PlanChange,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { parentRemoteId: cardId } = await resolveJobCard(orgId, jobId.trim().slice(0, 80));
  const { data: job } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", orgId).eq("uuid", cardId).maybeSingle();
  if (!job) return { ok: false, reason: "That job isn't here." };
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { org_id: orgId, sm8_job_uuid: cardId, updated_at: now };

  if ("visits" in change) {
    const visits = cleanVisits(change.visits);
    if (!visits) return { ok: false, reason: "Each visit needs its people (1 to 50) and its days." };
    if (visits.length === 0) {
      Object.assign(row, { visits: null, day_hours: null, hours_by: who.id, hours_by_name: who.name, hours_at: now });
    } else {
      const set = (await readOrgDay(orgId).catch(() => null))?.hours?.hours ?? null;
      const typed = Number(change.dayHours);
      const day = set ?? (Number.isFinite(typed) && typed > 0 && typed <= 24 ? typed : null);
      if (!day) return { ok: false, reason: "Say how many hours are in a working day." };
      Object.assign(row, { visits: visits satisfies PlanVisit[], day_hours: day, hours_by: who.id, hours_by_name: who.name, hours_at: now });
    }
  }
  if ("materialsCents" in change) {
    const c = change.materialsCents === null ? null : Number(change.materialsCents);
    if (c !== null && (!Number.isInteger(c) || c < 0 || c > 10_000_000_000)) return { ok: false, reason: "The materials need a dollar figure." };
    Object.assign(row, { materials_cents: c === 0 ? null : c, materials_by: who.id, materials_by_name: who.name, materials_at: now });
  }

  const { error } = await supabaseAdmin.from("job_tracker_plans").upsert(row, { onConflict: "org_id,sm8_job_uuid" });
  if (error) {
    console.error("[job-tracker] couldn't save the plan:", error);
    return { ok: false, reason: "That didn't save. Try again." };
  }
  return { ok: true };
}
