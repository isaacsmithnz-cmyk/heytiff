import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import { naiveInZone } from "@/lib/workboard/job-story";
import { jobDoorLabel } from "./diary-feed";
import { NAME_COLUMNS } from "./tasks-query";
import type { NoteThread } from "./shared-notes";

/* THE NOTES WAITING ON YOU, for Your feed (New › Note, Isaac, 24 October
   2026). Every thread you are in and haven't said Done to, or that someone
   has written in since you did: its notes oldest first, each by name and on
   the account's clock, and the job it is about. Server only; the caller
   hands in the org, the viewer's staff card and the account's zone. A read
   that fails leaves the notes out, never the feed. */

const LIMIT = 50;

type PersonRow = { thread_id: string; via_office: boolean };
type NoteRow = {
  id: string;
  thread_id: string | null;
  author_id: string;
  body: string;
  job_uuid: string | null;
  to_office: boolean;
  created_at: string;
};

export async function readOpenNotes(orgId: string, staffId: string | null, tz: string | null): Promise<NoteThread[]> {
  if (!staffId) return [];
  const { data: mine, error } = await supabaseAdmin
    .from("shared_note_people")
    .select("thread_id, via_office")
    .eq("org_id", orgId)
    .eq("staff_id", staffId)
    .is("done_at", null)
    .limit(LIMIT);
  if (error || !mine?.length) return [];
  const rows = mine as PersonRow[];
  const ids = rows.map((r) => r.thread_id);
  const { data: notes } = await supabaseAdmin
    .from("shared_notes")
    .select("id, thread_id, author_id, body, job_uuid, to_office, created_at")
    .eq("org_id", orgId)
    .or(`id.in.(${ids.join(",")}),thread_id.in.(${ids.join(",")})`)
    .order("created_at", { ascending: true })
    .limit(LIMIT * 20);
  const all = (notes ?? []) as NoteRow[];
  const authors = [...new Set(all.map((n) => n.author_id))];
  const jobs = [...new Set(all.map((n) => n.job_uuid).filter((j): j is string => !!j))];
  const [people, jobRows] = await Promise.all([
    authors.length
      ? supabaseAdmin.from("staff_profiles").select(NAME_COLUMNS).eq("org_id", orgId).in("id", authors).then((r) => r.data ?? [])
      : Promise.resolve([]),
    jobs.length
      ? supabaseAdmin
          .from("sm8_jobs")
          .select("uuid, generated_job_id, geo_city")
          .eq("org_id", orgId)
          .in("uuid", jobs)
          .then((r) => (r.data ?? []) as { uuid: string; generated_job_id: string | null; geo_city: string | null }[])
      : Promise.resolve([]),
  ]);
  const nameOf = new Map((people as { id: string }[]).map((p) => [p.id, displayNameOf(p as Parameters<typeof displayNameOf>[0], "Someone")]));
  const jobOf = new Map(jobRows.map((j) => [j.uuid, jobDoorLabel(j.generated_job_id, j.geo_city)]));

  const out: NoteThread[] = [];
  for (const r of rows) {
    const root = all.find((n) => n.id === r.thread_id);
    if (!root) continue;
    const messages = all
      .filter((n) => n.id === root.id || n.thread_id === root.id)
      .map((n) => ({
        id: n.id,
        authorId: n.author_id,
        name: nameOf.get(n.author_id) ?? "Someone",
        body: n.body,
        at: naiveInZone(n.created_at, tz) ?? n.created_at.slice(0, 16).replace("T", " "),
      }));
    out.push({
      threadId: root.id,
      rootAuthorId: root.author_id,
      jobUuid: root.job_uuid,
      jobLabel: root.job_uuid ? (jobOf.get(root.job_uuid) ?? null) : null,
      toOffice: root.to_office,
      viaOffice: r.via_office,
      messages,
    });
  }
  return out;
}
