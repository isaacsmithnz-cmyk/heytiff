import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";

/* A JOB'S OWN PICK LIST, read and written for a workspace already checked:
   the web's actions (app/actions/job-picklist, behind `workboard`) and the
   phone's /api/mobile/jobs/[id]/materials both come through here, so the two
   doors keep one list. Moved out of the actions file unchanged, since a
   "use server" file can't export a function that takes an org. */

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

export type Row = {
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

export const toItem = (r: Row, nameOf: (sub: string | null) => string | null): JobPicklistItem => ({
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

export const PICKLIST_SELECT =
  "id, name, sub, qty, kind, picked, picked_at, picked_by, added_by, design_id, added_at";

/* One read for every stamp on the list. Deliberately tolerant: a sub with no
   staff card resolves to null and the row simply goes unattributed. */
export async function staffNames(subs: readonly (string | null)[]): Promise<(s: string | null) => string | null> {
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

/** Everything on a job's list, in its order. */
export async function listPicklistOf(orgId: string, jobUuid: string): Promise<JobPicklistItem[]> {
  const { data, error } = await supabaseAdmin
    .from("job_picklist_items")
    .select(PICKLIST_SELECT)
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data as Row[];
  const nameOf = await staffNames(rows.flatMap((r) => [r.picked_by, r.added_by]));
  return rows.map((r) => toItem(r, nameOf));
}

/** A row typed (or a quote's unit ticked) onto the job's list, at its end. */
export async function addPicklistTo(
  orgId: string,
  userId: string,
  jobUuid: string,
  input: { kind: "material" | "todo"; name: string; qty?: string; sub?: string }
): Promise<JobPicklistItem> {
  const job = jobUuid.trim();
  if (!job) throw new Error("No job to add to");
  const name = input.name.trim();
  if (!name) throw new Error("Nothing to add");
  const qty = input.kind === "material" ? (input.qty ?? "").trim() : "";
  /* a material picked from the price book keeps its code and supplier */
  const sub = input.kind === "material" ? (input.sub ?? "").trim().slice(0, 120) : "";

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
      sub,
      qty,
      position: base + 1,
      added_by: userId,
    })
    .select(PICKLIST_SELECT)
    .single();
  if (error) throw new Error(error.message);
  const nameOf = await staffNames([userId]);
  return toItem(data as Row, nameOf);
}

/** A row ticked as loaded, or unticked, stamped with who. */
export async function setPickedOn(orgId: string, userId: string, itemId: string, picked: boolean): Promise<JobPicklistItem | null> {
  const { data, error } = await supabaseAdmin
    .from("job_picklist_items")
    .update({
      picked,
      picked_at: picked ? new Date().toISOString() : null,
      picked_by: picked ? userId : null,
    })
    .eq("org_id", orgId)
    .eq("id", itemId)
    .select(PICKLIST_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const nameOf = await staffNames([userId]);
  return toItem(data as Row, nameOf);
}
