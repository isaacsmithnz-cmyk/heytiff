"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { displayNameOf } from "@/lib/staff/name";
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

/** One row of the job's own checklist. `kind` is the section it lives in —
    material (quantity-bearing, what the Studio pushes) or todo (tickable
    work typed on the card). `addedBy`/`pickedBy` are DISPLAY NAMES, resolved
    here against staff_profiles — the table stores auth ids, and an auth id
    printed at somebody is not a stamp. Null when the id has no card. */
export interface JobPicklistItem {
  id: string;
  name: string;
  sub: string;
  qty: string;
  kind: "material" | "todo";
  picked: boolean;
  pickedAt: string | null;
  pickedBy: string | null;
  addedBy: string | null;
  /** the design it came from; null for a typed row or a deleted design */
  designId: string | null;
  addedAt: string;
}

type Row = {
  id: string;
  name: string;
  sub: string;
  qty: string;
  kind: "material" | "todo";
  picked: boolean;
  picked_at: string | null;
  picked_by: string | null;
  added_by: string | null;
  design_id: string | null;
  added_at: string;
};

const toItem = (r: Row, nameOf: (sub: string | null) => string | null): JobPicklistItem => ({
  id: r.id,
  name: r.name,
  sub: r.sub,
  qty: r.qty,
  kind: r.kind,
  picked: r.picked,
  pickedAt: r.picked_at,
  pickedBy: nameOf(r.picked_by),
  addedBy: nameOf(r.added_by),
  designId: r.design_id,
  addedAt: r.added_at,
});

const SELECT =
  "id, name, sub, qty, kind, picked, picked_at, picked_by, added_by, design_id, added_at";

/* One read for every stamp on the list. Deliberately tolerant: a sub with no
   staff card resolves to null and the row simply goes unattributed. */
async function staffNames(subs: readonly (string | null)[]): Promise<(s: string | null) => string | null> {
  const wanted = [...new Set(subs.filter((s): s is string => !!s))];
  if (wanted.length === 0) return () => null;
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("user_id, first_name, last_name, full_name, preferred_name")
    .in("user_id", wanted);
  const byId = new Map<string, string>();
  type NameRow = { user_id: string | null } & Parameters<typeof displayNameOf>[0];
  for (const r of (data ?? []) as NameRow[]) {
    if (r.user_id) {
      const name = displayNameOf(r, "");
      if (name) byId.set(r.user_id, name);
    }
  }
  return (s) => (s ? byId.get(s) ?? null : null);
}

/** Everything on a job's checklist, in the order the sheet listed it. */
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
  const rows = data as Row[];
  const nameOf = await staffNames(rows.flatMap((r) => [r.picked_by, r.added_by]));
  return rows.map((r) => toItem(r, nameOf));
}

/** Type a row straight onto the job's checklist — the composer at the face's
    head. Same capability as ticking: writing on the job's own list is the
    crew's act, not an administrative one. */
export async function addJobPicklistItem(
  jobUuid: string,
  input: { kind: "material" | "todo"; name: string; qty?: string }
): Promise<JobPicklistItem> {
  const { orgId, userId } = await requireOrg("workboard");
  const job = jobUuid.trim();
  if (!job) throw new Error("No job to add to");
  const name = input.name.trim();
  if (!name) throw new Error("Nothing to add");
  const qty = input.kind === "material" ? (input.qty ?? "").trim() : "";

  /* append after whatever is there — same law as the push */
  const { data: tail } = await supabaseAdmin
    .from("job_picklist_items")
    .select("position")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", job)
    .order("position", { ascending: false })
    .limit(1);
  const base = ((tail ?? [])[0]?.position as number | undefined) ?? -1;

  const { data, error } = await supabaseAdmin
    .from("job_picklist_items")
    .insert({
      org_id: orgId,
      sm8_job_uuid: job,
      design_id: null,
      kind: input.kind,
      name,
      sub: "",
      qty,
      position: base + 1,
      added_by: userId,
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  const nameOf = await staffNames([userId]);
  return toItem(data as Row, nameOf);
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
        /* the push IS the materials section — see job_checklist_kind.sql */
        kind: "material",
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
    job card — it is the warehouse's own act, not an administrative one.

    RETURNS THE SAVED ROW, because the stamp's whole point is WHO: the client
    can optimistically flip a checkbox, but it cannot know the display name
    behind its own auth id, and a stamp that reads "9:11pm" until the card is
    reopened is missing the half that matters. */
export async function setPicklistItemPicked(
  itemId: string,
  picked: boolean
): Promise<JobPicklistItem | null> {
  const { orgId, userId } = await requireOrg("workboard");
  const { data, error } = await supabaseAdmin
    .from("job_picklist_items")
    .update({
      picked,
      picked_at: picked ? new Date().toISOString() : null,
      picked_by: picked ? userId : null,
    })
    .eq("org_id", orgId)
    .eq("id", itemId)
    .select(SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const nameOf = await staffNames([userId]);
  return toItem(data as Row, nameOf);
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
