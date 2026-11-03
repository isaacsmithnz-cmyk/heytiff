import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { localNow } from "@/lib/integrations/sm8-booking-plan";
import type { MobileCtx } from "./auth";
import {
  amount,
  askOf,
  dayAllowed,
  keyOf,
  peopleOf,
  planAdd,
  settle,
  stepsOf,
  viewOf,
  type Ask,
  type Choice,
  type Ready,
  type Settle,
  type Step,
  type UsedLine,
  type UsedRow,
} from "./used-plan";

/* WHAT WAS USED ON A JOB TODAY, read and written (used-plan has the rules,
   docs/migrations/job_materials_used.sql the table). One list per job per
   day, shared by everyone on it; the check for a repeat runs at Add, here,
   against the list as it is then, so two people pressing Add in the same
   second both get it right: the table holds one live line per thing, and
   the second insert becomes the question. Quantities only: no price is
   read or shown here, those stay on the Job tracker. */

const COLUMNS = "id, sm8_job_uuid, day, supplier_key, code, name, qty, unit, choices, added_by, added_by_staff, words, open_repeat, history, removed_at, created_at, updated_at";

export type UsedList = { day: string; lines: UsedLine[] };
export type Wrong = { error: string; status: number };

/** Today on the account's own clock. */
export async function todayOf(orgId: string, now: number = Date.now()): Promise<string> {
  const zone = await bookingZone(orgId);
  return (zone.zone ? localNow(zone.zone, now)?.slice(0, 10) : null) ?? new Date(now).toISOString().slice(0, 10);
}

/** The day asked for, when the list may be kept for it. */
export async function dayFor(orgId: string, day: unknown, now: number = Date.now()): Promise<string | null> {
  const today = await todayOf(orgId, now);
  if (day === undefined || day === null || day === "") return today;
  return dayAllowed(day, today) ? day : null;
}

async function liveRows(orgId: string, job: string, day: string): Promise<UsedRow[]> {
  const { data, error } = await supabaseAdmin
    .from("job_materials_used")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", job)
    .eq("day", day)
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as UsedRow[];
}

/** First names by auth user id. */
async function namesOf(orgId: string, users: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (users.length === 0) return out;
  const { data } = await supabaseAdmin.from("staff_profiles").select("user_id, first_name, full_name").eq("org_id", orgId).in("user_id", [...new Set(users)]);
  for (const r of (data ?? []) as { user_id: string | null; first_name: string | null; full_name: string | null }[]) {
    const n = r.first_name?.trim() || r.full_name?.trim().split(/\s+/)[0];
    if (r.user_id && n) out.set(r.user_id, n);
  }
  return out;
}

async function view(ctx: MobileCtx, rows: readonly UsedRow[], more: readonly UsedRow[] = []): Promise<{ names: Map<string, string>; lines: UsedLine[] }> {
  const names = await namesOf(ctx.orgId, peopleOf([...rows, ...more]));
  return { names, lines: rows.map((r) => viewOf(r, names, ctx.userId)) };
}

/** The job's list for the day. */
export async function readUsed(ctx: MobileCtx, job: string, day: string): Promise<UsedList> {
  const rows = await liveRows(ctx.orgId, job, day);
  return { day, lines: (await view(ctx, rows)).lines };
}

/** What was said goes on the list: the new things as lines, a repeat as a question. */
export async function addUsed(ctx: MobileCtx, job: string, day: string, words: string, found: readonly Ready[]): Promise<{ added: UsedLine[]; asks: Ask[]; lines: UsedLine[] }> {
  const staff = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  const at = new Date().toISOString();
  const { add, asks } = planAdd(await liveRows(ctx.orgId, job, day), found);
  const added: UsedRow[] = [];
  const asked = [...asks];
  for (const f of add) {
    const step: Step = { at, by: ctx.userId, staff, kind: "said", qty: f.qty };
    const { data, error } = await supabaseAdmin
      .from("job_materials_used")
      .insert({
        org_id: ctx.orgId,
        sm8_job_uuid: job,
        day,
        supplier_key: f.supplierKey,
        code: f.code,
        name: f.name.trim().slice(0, 200),
        qty: f.qty,
        unit: f.unit,
        choices: f.supplierKey ? null : f.choices,
        added_by: ctx.userId,
        added_by_staff: staff,
        words: words.slice(0, 2000),
        history: [step],
      })
      .select(COLUMNS)
      .single();
    if (!error && data) {
      added.push(data as UsedRow);
      continue;
    }
    /* someone put it on a moment ago: theirs stands, and this is the question */
    if (error?.code === "23505") {
      const now = await liveRows(ctx.orgId, job, day);
      const row = now.find((r) => keyOf({ supplierKey: r.supplier_key, code: r.code, name: r.name }) === keyOf(f));
      if (row) {
        asked.push({ row, said: f.qty });
        continue;
      }
    }
    throw new Error(error?.message ?? "Couldn't add that to the list.");
  }
  const rows = await liveRows(ctx.orgId, job, day);
  const { names, lines } = await view(ctx, rows, asked.map((a) => a.row));
  return { added: added.map((r) => viewOf(r, names, ctx.userId)), asks: asked.map((a) => askOf(a.row, a.said, names, ctx.userId)), lines };
}

export type Change =
  | { do: "settle"; said: number; how: Settle }
  | { do: "amount"; qty: number }
  | { do: "pick"; supplierKey: string; code: string }
  | { do: "off" };

/** A line changed by anyone on the job: a repeat settled, its figure, which of the book's items it is, or off the list.
    Read and written on its last change, so two at once don't undo each other. */
export async function changeUsed(ctx: MobileCtx, job: string, lineId: string, change: Change): Promise<{ line: UsedLine | null; lines: UsedLine[] } | Wrong> {
  const staff = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await supabaseAdmin.from("job_materials_used").select(COLUMNS).eq("org_id", ctx.orgId).eq("sm8_job_uuid", job).eq("id", lineId).is("removed_at", null).maybeSingle();
    const row = data as UsedRow | null;
    if (!row) return { error: "That's no longer on the list.", status: 404 };
    const who = { by: ctx.userId, staff, at: new Date().toISOString() };
    let patch: Record<string, unknown>;
    if (change.do === "settle") patch = settle(row, change.said, change.how, who);
    else if (change.do === "amount") patch = amount(row, change.qty, who);
    else if (change.do === "off") patch = { removed_at: who.at, history: [...stepsOf(row.history), { ...who, kind: "off", qty: Number(row.qty) } satisfies Step] };
    else {
      const choice = (Array.isArray(row.choices) ? (row.choices as Choice[]) : []).find((c) => c.supplierKey === change.supplierKey && c.code === change.code);
      if (!choice) return { error: "That isn't one of its choices.", status: 400 };
      patch = {
        supplier_key: choice.supplierKey,
        code: choice.code,
        name: choice.name,
        choices: null,
        history: [...stepsOf(row.history), { ...who, kind: "picked", qty: Number(row.qty), item: choice.name } satisfies Step],
      };
    }
    const { data: done, error } = await supabaseAdmin
      .from("job_materials_used")
      .update({ ...patch, updated_at: who.at })
      .eq("org_id", ctx.orgId)
      .eq("id", lineId)
      .eq("updated_at", row.updated_at)
      .select(COLUMNS);
    if (error?.code === "23505") return { error: `${(patch.name as string) ?? row.name} is already on today's list. Change its amount there.`, status: 409 };
    if (error) throw new Error(error.message);
    if (!done?.length) continue;
    const after = done[0] as UsedRow;
    const rows = await liveRows(ctx.orgId, job, row.day);
    const { names, lines } = await view(ctx, rows, [after]);
    return { line: after.removed_at ? null : viewOf(after, names, ctx.userId), lines };
  }
  return { error: "Someone else is changing it. Try again.", status: 409 };
}

/** Whether the workspace's mirror holds this job. */
export async function jobHeld(orgId: string, uuid: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", orgId).in("uuid", [uuid, uuid.toLowerCase()]).limit(1);
  return !!data?.length;
}
