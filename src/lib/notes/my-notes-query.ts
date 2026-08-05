/* My notes — the read side. Server only, org-scoped AND person-scoped.

   NO SESSION HERE: callers establish the right to ask and hand in an orgId,
   the same posture as every other read module in this feature.

   THE PERSON SCOPE IS NOT OPTIONAL. Every function takes a staffId and
   filters on it. These are notes someone couldn't file against a job —
   the leftovers of their own day — and the table exists precisely because
   they need a reader. That reader is the author, and nobody else. */

import { supabaseAdmin } from "@/lib/supabase-server";

export type MyNote = {
  id: string;
  body: string;
  source: "text" | "voice" | "routed";
  /** The routed note this fell out of, when it fell out of one. */
  sourceNoteId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

const COLUMNS = "id, body, source, source_note_id, created_at, updated_at, archived_at";

type Row = {
  id: string;
  body: string;
  source: string;
  source_note_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

const isSource = (v: string): v is MyNote["source"] =>
  v === "text" || v === "voice" || v === "routed";

const toNote = (r: Row): MyNote => ({
  id: r.id,
  body: r.body,
  source: isSource(r.source) ? r.source : "text",
  sourceNoteId: r.source_note_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  archivedAt: r.archived_at,
});

/** Live notes, newest first — matches the partial index exactly. */
export async function listMyNotes(
  orgId: string,
  staffId: string,
  limit = 200
): Promise<MyNote[]> {
  const { data } = await supabaseAdmin
    .from("staff_notes")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("staff_id", staffId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Row[]).map(toNote);
}

/** Put-away notes. Separate call because the common screen never wants them
    and paying for them on every load would be paying for the rare case. */
export async function listArchivedNotes(
  orgId: string,
  staffId: string,
  limit = 100
): Promise<MyNote[]> {
  const { data } = await supabaseAdmin
    .from("staff_notes")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("staff_id", staffId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Row[]).map(toNote);
}

/** How many are waiting, for a nav badge or a dashboard line. `head: true`
    so the rows never travel just to be counted. */
export async function countMyNotes(orgId: string, staffId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("staff_notes")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("staff_id", staffId)
    .is("archived_at", null);
  return count ?? 0;
}
