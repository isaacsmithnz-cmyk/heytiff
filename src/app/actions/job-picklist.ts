"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import type { PicklistRow } from "@/lib/studio/summary";

/* The Material picklist a Studio design pushes onto a HeyTiff job card.

   OURS, NOT SERVICEM8'S. The job sheet already shows "Their checklist" out of
   the SM8 mirror, and that mirror is READ-ONLY — we cannot write a checklist
   item into ServiceM8 today. This is the HeyTiff side: our list, on our job
   card, ticked by our staff. See docs/migrations/job_picklist.sql.

   Same discipline as every other action here: authenticate the Auth0 session,
   then read/write through the service role with an explicit org scope. Server
   Functions are reachable by direct POST, so every function re-checks the
   capability for itself. */

export interface JobPicklistItem {
  id: string;
  name: string;
  sub: string;
  qty: string;
  picked: boolean;
  pickedAt: string | null;
  pickedBy: string | null;
  /** the design it came from; null once that design is deleted */
  designId: string | null;
  addedAt: string;
}

type Row = {
  id: string;
  name: string;
  sub: string;
  qty: string;
  picked: boolean;
  picked_at: string | null;
  picked_by: string | null;
  design_id: string | null;
  added_at: string;
};

const toItem = (r: Row): JobPicklistItem => ({
  id: r.id,
  name: r.name,
  sub: r.sub,
  qty: r.qty,
  picked: r.picked,
  pickedAt: r.picked_at,
  pickedBy: r.picked_by,
  designId: r.design_id,
  addedAt: r.added_at,
});

const SELECT = "id, name, sub, qty, picked, picked_at, picked_by, design_id, added_at";

/** Everything on a job's picklist, in the order the sheet listed it. */
export async function listJobPicklist(
  jobUuid: string
): Promise<JobPicklistItem[]> {
  const { orgId } = await requireOrg("workboard");
  const { data, error } = await supabaseAdmin
    .from("job_picklist_items")
    .select(SELECT)
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Row[]).map(toItem);
}

export interface PushResult {
  added: number;
  /** already on the job from this design — a second click adds nothing */
  alreadyThere: number;
}

/** Push a design's Material picklist onto its linked job.

    IDEMPOTENT BY (design, name): pushing twice does not double the list. The
    quantity is deliberately NOT compared — if the design changed and a row is
    already on the job, the picked list stays as it was ordered. Re-pushing is
    for what is MISSING, never for silently rewriting a number somebody has
    already picked against. */
export async function pushPicklistToJob(
  jobUuid: string,
  designId: string,
  rows: PicklistRow[]
): Promise<PushResult> {
  /* BOTH capabilities, deliberately: `studio` is the surface doing the
     pushing, `workboard` is what makes the job card writable at all. Same
     shape as the studio's ServiceM8 job search. */
  const { orgId, userId } = await requireOrg("studio");
  await requireOrg("workboard");

  const job = jobUuid.trim();
  if (!job) throw new Error("No job to add to");
  if (rows.length === 0) return { added: 0, alreadyThere: 0 };

  const { data: existing, error: readErr } = await supabaseAdmin
    .from("job_picklist_items")
    .select("name, position")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", job);
  if (readErr) throw new Error(readErr.message);

  const have = new Set((existing ?? []).map((r) => (r as { name: string }).name));
  /* append after whatever is already there, so a second push doesn't
     interleave itself through a list somebody is working down */
  const base = (existing ?? []).reduce(
    (m, r) => Math.max(m, (r as { position: number }).position),
    -1
  );

  const fresh = rows.filter((r) => !have.has(r.name));
  if (fresh.length > 0) {
    const { error } = await supabaseAdmin.from("job_picklist_items").insert(
      fresh.map((r, i) => ({
        org_id: orgId,
        sm8_job_uuid: job,
        design_id: designId,
        name: r.name,
        sub: r.sub,
        qty: r.qty,
        position: base + 1 + i,
        added_by: userId,
      }))
    );
    if (error) throw new Error(error.message);
  }
  return { added: fresh.length, alreadyThere: rows.length - fresh.length };
}

/** Tick or untick one item. Picking is intrinsic to anyone who can read the
    job card — it is the warehouse's own act, not an administrative one. */
export async function setPicklistItemPicked(
  itemId: string,
  picked: boolean
): Promise<void> {
  const { orgId, userId } = await requireOrg("workboard");
  const { error } = await supabaseAdmin
    .from("job_picklist_items")
    .update({
      picked,
      picked_at: picked ? new Date().toISOString() : null,
      picked_by: picked ? userId : null,
    })
    .eq("org_id", orgId)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

/** Remove one item — a picklist is editable; a wrong line should not have to
    be lived with. */
export async function removePicklistItem(itemId: string): Promise<void> {
  const { orgId } = await requireOrg("workboard");
  const { error } = await supabaseAdmin
    .from("job_picklist_items")
    .delete()
    .eq("org_id", orgId)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}
