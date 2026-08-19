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
  /** quantity corrected on rows NOBODY has picked yet */
  updated: number;
  /** the design now says something different, but it is already picked — left
      exactly as it was, and reported so it is not a silent disagreement */
  heldBack: number;
  /** on the job from this design, but the design no longer lists it */
  orphaned: number;
  /** already there and still identical */
  unchanged: number;
}

/** Push a design's Material picklist onto its linked job — and re-push it
    after the design changes.

    THE RULE IS "never rewrite a number somebody has already picked against",
    and the fix here is to apply it only where it actually bites. A row nobody
    has touched can be corrected freely: leaving a stale 3.1 m on the job card
    because the pipe run grew to 18 m is not caution, it is a wrong number
    nobody asked for. A row already ticked is different — somebody has stood in
    the warehouse and acted on that figure — so it is left alone and REPORTED
    (`heldBack`) rather than quietly changed underneath them.

    Scoping matters twice over:

    - dedupe is by NAME across the whole job, so two designs pushing the same
      model do not put two lines on one list;
    - updates are scoped to THIS design's rows, so re-pushing one design never
      rewrites a figure another design put there.

    Nothing is ever deleted. A row the design has dropped is reported
    (`orphaned`), because it may already be picked, ordered or on a van — that
    is a decision for a person, not for a push. */
export async function pushPicklistToJob(
  jobUuid: string,
  designId: string,
  /* the three fields a job-card line IS, not the whole sheet row. The picklist
     also carries which shelf a line comes off, and that is a fact about how the
     SHEET groups its consumables — a job card has one list. */
  rows: Pick<PicklistRow, "name" | "sub" | "qty">[]
): Promise<PushResult> {
  /* BOTH capabilities, deliberately: `studio` is the surface doing the
     pushing, `workboard` is what makes the job card writable at all. Same
     shape as the studio's ServiceM8 job search. */
  const { orgId, userId } = await requireOrg("studio");
  await requireOrg("workboard");

  const job = jobUuid.trim();
  if (!job) throw new Error("No job to add to");

  const nil: PushResult = {
    added: 0,
    updated: 0,
    heldBack: 0,
    orphaned: 0,
    unchanged: 0,
  };

  const { data: existing, error: readErr } = await supabaseAdmin
    .from("job_picklist_items")
    .select("id, name, sub, qty, picked, design_id, position")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", job);
  if (readErr) throw new Error(readErr.message);

  type Have = {
    id: string;
    name: string;
    sub: string;
    qty: string;
    picked: boolean;
    design_id: string | null;
    position: number;
  };
  const onJob = (existing ?? []) as Have[];
  const byName = new Map(onJob.map((r) => [r.name, r]));

  /* an EMPTY push still reports what the design has dropped — a design
     emptied of systems is exactly when the job card is most stale */
  const wanted = new Map(rows.map((r) => [r.name, r]));
  const orphaned = onJob.filter(
    (r) => r.design_id === designId && !wanted.has(r.name)
  ).length;

  if (rows.length === 0) return { ...nil, orphaned };

  /* append after whatever is already there, so a second push doesn't
     interleave itself through a list somebody is working down */
  const base = onJob.reduce((m, r) => Math.max(m, r.position), -1);

  const fresh = rows.filter((r) => !byName.has(r.name));
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

  let updated = 0;
  let heldBack = 0;
  let unchanged = 0;
  for (const r of rows) {
    const cur = byName.get(r.name);
    if (!cur) continue; // just inserted above
    if (cur.qty === r.qty && cur.sub === r.sub) {
      unchanged++;
      continue;
    }
    /* another design's row, or one already picked — say so, change nothing */
    if (cur.design_id !== designId || cur.picked) {
      heldBack++;
      continue;
    }
    const { error } = await supabaseAdmin
      .from("job_picklist_items")
      .update({ qty: r.qty, sub: r.sub })
      .eq("org_id", orgId)
      .eq("id", cur.id);
    if (error) throw new Error(error.message);
    updated++;
  }

  return { added: fresh.length, updated, heldBack, orphaned, unchanged };
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
