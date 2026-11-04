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
import { dayName, labourDays, qtyWord, type TrackerItem, type TrackerRead } from "./job-tracker";

/* THE JOB TRACKER'S READ (job-tracker.ts has the rules). Labour comes from
   job-money's count of the job's hours, the phone's own, so the two never
   tell two stories; the quote's hours are its accepted option's labour
   lines, else what the quote plan gives (the brief's hours or its days).
   Materials are job_materials_used, read only: the phone's wrap-up writes
   that table and nothing here does. Costs (every dollar figure here is at
   cost) only for whoever holds `financials`. Null when the job isn't here. */

type UsedRow = { day: string; supplier_key: string | null; code: string | null; name: string; qty: number | string; unit: string | null };

export async function readJobTracker(orgId: string, caps: ReadonlySet<Capability>, jobId: string): Promise<TrackerRead | null> {
  const ctx = { userId: "", orgId, role: null, caps: new Set(caps), orgIds: [orgId] } satisfies MobileCtx;
  const money = await readJobMoney(ctx, jobId);
  if (!money) return null;
  const { parentRemoteId: cardId } = await resolveJobCard(orgId, jobId.trim().slice(0, 80));
  const costs = caps.has("financials");

  const [plan, pay, used, lines, draft, products] = await Promise.all([
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
  ]);

  /* LABOUR */
  const quotedHours = money.allowed && money.allowed.labourHours > 0 ? money.allowed.labourHours : (plan?.hours ?? null);
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

  return {
    labour: { quotedHours, workedHours: lab.worked, paidHours: lab.paid, days: lab.days, leftOn: money.labour.leftOn },
    materials: {
      allowance: costs ? (money.allowed?.materialsCents ?? null) : null,
      spent: costs ? spent : null,
      unpriced,
      count: things.size,
      items: matItems,
    },
    equipment: { total: units.length ? (costs ? (money.allowed?.unitsCents ?? null) : null) : null, items: eqItems },
  };
}
