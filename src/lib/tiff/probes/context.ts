/* WHAT THE ROUTER WAS TOLD, FOR A NOTE ALREADY IN THE DIARY — server only,
   read only, for the Phase 0 probes.

   The same reads `routingContext` makes in actions/workboard-notes.ts, made
   for a stored note instead of a live press: who can be given work, who was
   speaking, the job and what the workspace knows about it, the day it was
   said. That function is private to a "use server" file that also writes,
   so the probe rebuilds it here from the same exported readers rather than
   import a module whose every other export touches the database. Nothing
   in this file writes anything. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { NAME_COLUMNS } from "@/lib/dashboard/tasks-query";
import { fullNameOf } from "@/lib/staff/name";
import { workdayHours } from "@/lib/dashboard/reminders-query";
import { jobHistory } from "@/lib/brain/tools";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { isTiffRoom, type TiffRoom } from "@/lib/workboard/note-turns";
import type { NoteContext, NoteStaff } from "@/lib/workboard/note-brain";
import type { NoteTarget } from "@/app/actions/workboard-notes";

export type StoredNote = {
  id: string;
  orgId: string;
  authorId: string | null;
  target: NoteTarget;
  transcript: string;
  createdAt: string;
  room?: TiffRoom;
};

/** Every note with words in it, oldest first, one per distinct transcript:
    the same words said twice would only count the same result twice. */
export async function storedNotes(): Promise<StoredNote[]> {
  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, org_id, author_id, target_kind, target_id, transcript, created_at, turns")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`Couldn't read the notes: ${error.message}`);

  const seen = new Set<string>();
  const out: StoredNote[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const transcript = String(row.transcript ?? "").trim();
    const key = transcript.toLowerCase().replace(/\s+/g, " ");
    if (!transcript || seen.has(key)) continue;
    seen.add(key);
    const turns = Array.isArray(row.turns) ? (row.turns as { room?: unknown }[]) : [];
    const room = turns.map((t) => t.room).find(isTiffRoom);
    out.push({
      id: String(row.id),
      orgId: String(row.org_id),
      authorId: row.author_id ? String(row.author_id) : null,
      target: {
        kind: String(row.target_kind) as NoteTarget["kind"],
        id: row.target_id ? String(row.target_id) : null,
      } as NoteTarget,
      transcript,
      createdAt: String(row.created_at),
      ...(room ? { room } : {}),
    });
  }
  return out;
}

async function staffOf(orgId: string): Promise<NoteStaff[]> {
  const { data } = await supabaseAdmin.from("staff_profiles").select(NAME_COLUMNS).eq("org_id", orgId).limit(200);
  return ((data ?? []) as Record<string, unknown>[])
    .map((s) => ({ id: String(s.id), fullName: fullNameOf(s) }))
    .filter((s) => s.fullName);
}

async function labelOf(orgId: string, target: NoteTarget): Promise<string | undefined> {
  if (!target.id) return undefined;
  if (target.kind === "project") {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("name, client_name")
      .eq("org_id", orgId)
      .eq("id", target.id)
      .maybeSingle();
    const row = data as { name: string; client_name: string | null } | null;
    return row ? [row.name, row.client_name].filter(Boolean).join(" — ") : undefined;
  }
  if (target.kind === "agreement") {
    const { data } = await supabaseAdmin
      .from("maintenance_agreements")
      .select("label, client_name")
      .eq("org_id", orgId)
      .eq("id", target.id)
      .maybeSingle();
    const row = data as { label: string; client_name: string } | null;
    return row ? `${row.label} — ${row.client_name}` : undefined;
  }
  if (target.kind === "job") {
    const { data } = await supabaseAdmin
      .from("sm8_jobs")
      .select("generated_job_id, company_uuid")
      .eq("org_id", orgId)
      .eq("uuid", target.id)
      .maybeSingle();
    const row = data as { generated_job_id: string | null; company_uuid: string | null } | null;
    if (!row) return undefined;
    const number = row.generated_job_id ? `#${row.generated_job_id}` : "ServiceM8 job";
    if (!row.company_uuid) return number;
    const { data: co } = await supabaseAdmin
      .from("sm8_companies")
      .select("name")
      .eq("org_id", orgId)
      .eq("uuid", row.company_uuid)
      .maybeSingle();
    const name = (co as { name: string | null } | null)?.name?.trim();
    return name ? `${number} — ${name}` : number;
  }
  return undefined;
}

/** The router's context for one stored note, as the Tiff modal reads notes
    today: it asks who rather than leave a task with nobody on it, and she
    says a line back. "Today" is the day the note was said, so "Friday"
    resolves against the week it was spoken in. */
export async function contextFor(note: StoredNote): Promise<NoteContext> {
  const [staff, label, tz, history, day] = await Promise.all([
    staffOf(note.orgId),
    labelOf(note.orgId, note.target),
    getSm8Timezone(note.orgId),
    jobHistory(note.orgId, note.target),
    workdayHours(note.orgId, note.authorId),
  ]);
  const author = note.authorId ? staff.find((s) => s.id === note.authorId) : undefined;
  return {
    staff,
    ...(author ? { author } : {}),
    dayStart: day.start,
    dayEnd: day.end,
    ...(label ? { targetLabel: label } : {}),
    todayISO: todayInZone(tz, new Date(note.createdAt)),
    ...(history.equipment.length ? { equipment: history.equipment } : {}),
    history: {
      issues: history.issues.map((i) => ({ summary: i.summary, occurrences: i.occurrences, lastSeen: i.lastSeen })),
      flags: history.flags.map((f) => f.message),
      recentNotes: history.recentNotes,
    },
    ...(note.room ? { room: note.room } : {}),
    askWho: true,
    speak: true,
  };
}
