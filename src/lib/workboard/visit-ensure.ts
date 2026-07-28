/* Keeping every agreement's visit rows real — the holiday-sync pattern
   (ensure-on-read, insert-only) applied to maintenance.

   ensureVisits    tops each active agreement up to the horizon. Insert-only:
                   the upsert ignores duplicates against (agreement_id,
                   due_date), so re-running is free and NOTHING existing is
                   ever moved or rewritten by generation.
   pruneAndRegen   the one deleting path, for cadence edits — and it deletes
                   ONLY pristine future visits (isPristineFuture): anything a
                   human touched survives, listed as off-schedule.
   autoComplete    the mirror tail: a visit whose explicitly-linked ServiceM8
                   job turned 'Completed' goes done on its own, stamped
                   completed_source='servicem8'. Safe because a human chose
                   that link; an Unsuccessful/deleted job is a WARN at read,
                   never an auto-skip.

   NO SESSION HERE — callers establish the right to ask. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { getSm8Timezone } from "./query";
import { todayInZone } from "./dates";
import { dueDatesFor, isPristineFuture } from "./visit-schedule";

type AgreementRow = {
  id: string;
  anchor_date: string;
  interval_months: number;
  contract_end: string | null;
};

/** Top up one agreement, or every active one. Bounded: ~13 rows per
    agreement per run, insert-only, so calling it on every page read is a
    cheap habit rather than a hazard. */
export async function ensureVisits(
  orgId: string,
  opts: { agreementId?: string; today?: string } = {}
): Promise<void> {
  const today = opts.today ?? todayInZone(await getSm8Timezone(orgId));

  let q = supabaseAdmin
    .from("maintenance_agreements")
    .select("id, anchor_date, interval_months, contract_end")
    .eq("org_id", orgId)
    .eq("status", "active");
  if (opts.agreementId) q = q.eq("id", opts.agreementId);
  const { data } = await q;

  for (const a of (data ?? []) as AgreementRow[]) {
    const due = dueDatesFor({
      anchorISO: a.anchor_date,
      intervalMonths: a.interval_months,
      fromISO: today,
      contractEndISO: a.contract_end,
    });
    if (due.length === 0) continue;

    await supabaseAdmin.from("maintenance_visits").upsert(
      due.map((d) => ({ org_id: orgId, agreement_id: a.id, due_date: d })),
      { onConflict: "agreement_id,due_date", ignoreDuplicates: true }
    );
  }
}

/** Cadence changed: redraw the future, respecting everything touched. */
export async function pruneAndRegenerate(orgId: string, agreementId: string): Promise<void> {
  const today = todayInZone(await getSm8Timezone(orgId));

  const { data } = await supabaseAdmin
    .from("maintenance_visits")
    .select("id, due_date, status, remote_id, job_number, readiness, notes")
    .eq("org_id", orgId)
    .eq("agreement_id", agreementId)
    .gt("due_date", today);

  const pristine = ((data ?? []) as {
    id: string;
    due_date: string;
    status: string;
    remote_id: string | null;
    job_number: string | null;
    readiness: unknown;
    notes: string | null;
  }[]).filter((v) =>
    isPristineFuture(
      {
        status: v.status,
        remoteId: v.remote_id,
        jobNumber: v.job_number,
        readiness: v.readiness,
        notes: v.notes,
        dueDate: v.due_date,
      },
      today
    )
  );

  if (pristine.length > 0) {
    await supabaseAdmin
      .from("maintenance_visits")
      .delete()
      .eq("org_id", orgId)
      .in("id", pristine.map((v) => v.id));
  }

  await ensureVisits(orgId, { agreementId, today });
}

/** The sync tail: linked job went 'Completed' over there → visit done here. */
export async function autoCompleteVisitsFromMirror(orgId: string): Promise<number> {
  const { data: visitRows } = await supabaseAdmin
    .from("maintenance_visits")
    .select("id, remote_id")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .in("status", ["upcoming", "booked"])
    .not("remote_id", "is", null);

  const visits = (visitRows ?? []) as { id: string; remote_id: string }[];
  if (visits.length === 0) return 0;

  const { data: jobRows } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, status, completion_date")
    .eq("org_id", orgId)
    .in("uuid", [...new Set(visits.map((v) => v.remote_id))]);

  const completed = new Map(
    ((jobRows ?? []) as { uuid: string; status: string | null; completion_date: string | null }[])
      .filter((j) => j.status === "Completed")
      .map((j) => [j.uuid, j.completion_date])
  );

  let moved = 0;
  for (const v of visits) {
    if (!completed.has(v.remote_id)) continue;
    const stamp = completed.get(v.remote_id);
    await supabaseAdmin
      .from("maintenance_visits")
      .update({
        status: "done",
        completed_source: "servicem8",
        // date part of the naive local string; the visit's own clock
        completed_at: stamp ? stamp.slice(0, 10) : todayInZone(await getSm8Timezone(orgId)),
      })
      .eq("org_id", orgId)
      .eq("id", v.id)
      // Guarded like every conditional write here: if a human already moved
      // it (skipped, done manually), the mirror does not overrule them.
      .in("status", ["upcoming", "booked"]);
    moved += 1;
  }
  return moved;
}
