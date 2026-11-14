import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import { DOCUMENTS_BUCKET, SIGNED_URL_SECONDS } from "@/lib/documents/query";
import { isVideoMime } from "@/lib/documents/files";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { jobMediaKind } from "@/lib/workboard/job-media";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { siteOf, siteSearch, unitWords, type Site } from "./site-key";
import {
  OLD_NOTE_SEARCH,
  SITE_NOTE_MAX,
  dayWords,
  likelyCodeLines,
  type OldCodeNote,
  type SiteJobRow,
  type SiteNoteKind,
  type SiteNoteRow,
  type SiteNotesRead,
  type SiteVideoChoice,
} from "./site-notes";

/* SITE NOTES ON THE SERVER (docs/migrations/site_notes.sql).

   Every read and write starts from a job this workspace's mirror holds, and
   works out its building from the job's address (site-key.ts): a note is
   only ever read or written for the building the job is at, so an id that
   came from a browser can't reach another site's notes. The gate is the
   caller's: the job card's, `workboard`, so everyone on staff who can open
   the job sees its codes.

   Staff only. Nothing that builds a customer email, a quote, a PDF or Tiff's
   words to a customer reads this table (__tests__/site-notes-kept-in.test.ts
   holds that). */

type JobRow = {
  uuid: string;
  generated_job_id: string | null;
  status: string | null;
  job_address: string | null;
  geo_city: string | null;
  geo_state: string | null;
  geo_postcode: string | null;
  job_description: string | null;
  date: string | null;
  quote_date: string | null;
  work_order_date: string | null;
  completion_date: string | null;
};

const JOB_COLUMNS =
  "uuid, generated_job_id, status, job_address, geo_city, geo_state, geo_postcode, job_description, date, quote_date, work_order_date, completion_date";

type NoteRow = {
  id: string;
  building_key: string;
  unit: string | null;
  kind: SiteNoteKind;
  words: string;
  video: string | null;
  written_by: string;
  written_by_staff: string | null;
  written_at: string;
  from_job_uuid: string | null;
};

const NOTE_COLUMNS = "id, building_key, unit, kind, words, video, written_by, written_by_staff, written_at, from_job_uuid";

async function jobOf(orgId: string, jobUuid: string): Promise<JobRow | null> {
  const id = jobUuid.trim().slice(0, 80);
  if (!id) return null;
  const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLUMNS).eq("org_id", orgId).eq("uuid", id).maybeSingle();
  return (data as JobRow | null) ?? null;
}

const siteOfJob = (j: JobRow): Site | null => siteOf(j.job_address, j.geo_city);

/* ---- the words for the building ---- */

const UNIT_LEAD = /^\s*(?:(?:unit|u|apartment|apt|flat|suite|shop|villa|townhouse)\s*[0-9]+[a-z]?\s*[,/]?\s*|[a-z]?[0-9]+[a-z]?\s*\/\s*)/i;

/** "106 Kirribilli Avenue" out of "2/106 Kirribilli Avenue\nKirribilli NSW 2061":
    the building, without the unit. */
export function buildingStreet(address: string | null): string {
  const first = (address ?? "").replace(/\r/g, "").split("\n")[0] ?? "";
  const street = first.split(",").find((p) => /\d/.test(p) && /[a-z]{3}/i.test(p.replace(UNIT_LEAD, ""))) ?? first;
  return street.replace(UNIT_LEAD, "").replace(/\s+/g, " ").trim();
}

/** "Kirribilli NSW 2061": ServiceM8's geocoded place, else the address's second line. */
function placeOf(j: JobRow): string {
  const geo = [j.geo_city, j.geo_state, j.geo_postcode].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  if (geo) return geo;
  const lines = (j.job_address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[1] ?? "").replace(/,\s+/g, " ").replace(/\s+/g, " ").trim();
}

/* ---- the other jobs at the building ---- */

const FINISHED = new Set(["completed", "unsuccessful"]);

function firstLine(text: string | null): string {
  return (text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^[\s*•\-#]+/, "").trim())
    .find(Boolean) ?? "";
}

function jobLine(j: JobRow, today: string): string {
  const day = (s: string | null) => dayWords((s ?? "").slice(0, 10), today);
  const status = (j.status ?? "").trim().toLowerCase();
  if (status === "completed") return j.completion_date ? `Done ${day(j.completion_date)}` : "Done";
  if (status === "unsuccessful") return "Didn't go ahead";
  if (status === "work order") {
    const since = j.work_order_date || j.date;
    return since ? `Work order since ${day(since)}` : "Work order";
  }
  if (status === "quote") {
    const since = j.quote_date || j.date;
    return since ? `Quote since ${day(since)}` : "Quote";
  }
  return j.status ?? "";
}

/** Every job at the building, this one too, newest first. */
async function jobsAt(orgId: string, key: string): Promise<{ job: JobRow; site: Site }[]> {
  const look = siteSearch(key);
  if (!look) return [];
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select(JOB_COLUMNS)
    .eq("org_id", orgId)
    .eq("active", 1)
    .ilike("job_address", `%${look.number}%`)
    .ilike("job_address", `%${look.word}%`)
    .limit(500);
  const out: { job: JobRow; site: Site }[] = [];
  for (const j of (data ?? []) as JobRow[]) {
    const site = siteOfJob(j);
    if (site?.key === key) out.push({ job: j, site });
  }
  return out.sort((a, b) => (b.job.date ?? "").localeCompare(a.job.date ?? "") || Number(b.job.generated_job_id ?? 0) - Number(a.job.generated_job_id ?? 0));
}

/* ---- who wrote it ---- */

async function namesOf(orgId: string, rows: readonly { written_by: string; written_by_staff: string | null }[]): Promise<(r: { written_by: string; written_by_staff: string | null }) => string | null> {
  const sm8Ids = [...new Set(rows.map((r) => (r.written_by.startsWith("sm8:") ? r.written_by.slice(4) : "")).filter(Boolean))];
  const [cards, sm8] = await Promise.all([
    staffDisplayNames(orgId, rows.map((r) => r.written_by_staff)),
    sm8Ids.length
      ? supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", orgId).in("uuid", sm8Ids)
      : Promise.resolve({ data: [] as { uuid: string; first: string | null; last: string | null }[] }),
  ]);
  const sm8Names = new Map(
    ((sm8.data ?? []) as { uuid: string; first: string | null; last: string | null }[]).map((s) => [s.uuid, [s.first, s.last].filter(Boolean).join(" ").trim()]),
  );
  return (r) => (r.written_by_staff ? cards.get(r.written_by_staff) : null) ?? (r.written_by.startsWith("sm8:") ? sm8Names.get(r.written_by.slice(4)) || null : null);
}

/* ---- videos ---- */

const DOC = "doc:";

/** This job's clips, ours and ServiceM8's, newest first, to keep one with an issue. */
async function videosOf(orgId: string, jobUuid: string, today: string): Promise<SiteVideoChoice[]> {
  const [{ data: sm8 }, { data: ours }] = await Promise.all([
    supabaseAdmin
      .from("sm8_attachments")
      .select("uuid, attachment_name, file_type, timestamp")
      .eq("org_id", orgId)
      .eq("related_object_uuid", jobUuid)
      .eq("active", 1)
      .limit(300),
    supabaseAdmin
      .from("documents")
      .select("id, file_name, mime_type, uploaded_at")
      .eq("org_id", orgId)
      .eq("kind", "job_photo")
      .eq("sm8_job_uuid", jobUuid)
      .not("uploaded_at", "is", null)
      .limit(120),
  ]);
  const out: { ref: string; name: string; at: string }[] = [];
  for (const a of (sm8 ?? []) as { uuid: string; attachment_name: string | null; file_type: string | null; timestamp: string | null }[]) {
    if (jobMediaKind(a.file_type) !== "video") continue;
    out.push({ ref: a.uuid, name: a.attachment_name || "Video", at: a.timestamp ?? "" });
  }
  for (const d of (ours ?? []) as { id: string; file_name: string | null; mime_type: string | null; uploaded_at: string }[]) {
    if (!isVideoMime(d.mime_type ?? "")) continue;
    out.push({ ref: `${DOC}${d.id}`, name: d.file_name || "Video", at: d.uploaded_at });
  }
  return out
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((v) => {
      const day = dayWords(v.at.slice(0, 10), today);
      return { ref: v.ref, name: day ? `${v.name}, ${day}` : v.name };
    });
}

/** Ours play from a signed address; ServiceM8's play in ServiceM8, on the job's page there. */
async function videoLinks(orgId: string, rows: readonly NoteRow[]): Promise<Map<string, SiteNoteRow["video"]>> {
  const map = new Map<string, SiteNoteRow["video"]>();
  const docIds = [...new Set(rows.map((r) => (r.video?.startsWith(DOC) ? r.video.slice(DOC.length) : "")).filter(Boolean))];
  const signed = new Map<string, string>();
  if (docIds.length) {
    const { data } = await supabaseAdmin.from("documents").select("id, storage_ref").eq("org_id", orgId).in("id", docIds);
    const refs = (data ?? []) as { id: string; storage_ref: string }[];
    if (refs.length) {
      const { data: urls } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).createSignedUrls(
        refs.map((r) => r.storage_ref),
        SIGNED_URL_SECONDS,
      );
      const byRef = new Map((urls ?? []).filter((u) => u.path && u.signedUrl).map((u) => [u.path!, u.signedUrl]));
      for (const r of refs) {
        const url = byRef.get(r.storage_ref);
        if (url) signed.set(r.id, url);
      }
    }
  }
  for (const r of rows) {
    if (!r.video) continue;
    if (r.video.startsWith(DOC)) {
      const url = signed.get(r.video.slice(DOC.length));
      if (url) map.set(r.id, { ref: r.video, url, inSm8: null });
    } else {
      const door = sm8JobUrl(r.from_job_uuid);
      if (door) map.set(r.id, { ref: r.video, url: null, inSm8: door });
    }
  }
  return map;
}

/* ---- the read ---- */

/** The notes this job shows, the building's and its own unit's: never another unit's. */
function shownOn(site: Site) {
  return (r: { building_key: string; unit: string | null }) => r.building_key === site.key && (r.unit === null || r.unit === site.unit);
}

async function currentNotes(orgId: string, key: string): Promise<NoteRow[]> {
  const { data } = await supabaseAdmin
    .from("site_notes")
    .select(NOTE_COLUMNS)
    .eq("org_id", orgId)
    .eq("building_key", key)
    .is("replaced_at", null)
    .is("removed_at", null)
    .order("written_at", { ascending: true })
    .limit(500);
  return (data ?? []) as NoteRow[];
}

/** How many notes this job shows: the mark on its button. */
export async function siteNoteCountFor(orgId: string, jobUuid: string): Promise<number | null> {
  const job = await jobOf(orgId, jobUuid);
  if (!job) return null;
  const site = siteOfJob(job);
  if (!site) return 0;
  return (await currentNotes(orgId, site.key)).filter(shownOn(site)).length;
}

export async function readSiteNotesFor(args: { orgId: string; jobUuid: string; tz: string | null }): Promise<SiteNotesRead | null> {
  const { orgId, tz } = args;
  const job = await jobOf(orgId, args.jobUuid);
  if (!job) return null;
  const today = todayInAu(new Date(), tz);
  const site = siteOfJob(job);
  const street = buildingStreet(job.job_address) || "No address on the job";
  const place = placeOf(job);
  if (!site) return { noSite: true, street, place, unit: null, notes: [], jobs: [], videos: [] };

  const [rows, here, videos] = await Promise.all([currentNotes(orgId, site.key), jobsAt(orgId, site.key), videosOf(orgId, job.uuid, today)]);
  const shown = rows.filter(shownOn(site));
  const numbers = new Map(here.map((h) => [h.job.uuid, h.job.generated_job_id]));
  const missing = [...new Set(shown.map((r) => r.from_job_uuid).filter((u): u is string => !!u && !numbers.has(u)))];
  const [nameOf, videoOf, more] = await Promise.all([
    namesOf(orgId, shown),
    videoLinks(orgId, shown),
    missing.length
      ? supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id").eq("org_id", orgId).in("uuid", missing)
      : Promise.resolve({ data: [] as { uuid: string; generated_job_id: string | null }[] }),
  ]);
  for (const m of (more.data ?? []) as { uuid: string; generated_job_id: string | null }[]) numbers.set(m.uuid, m.generated_job_id);

  const notes: SiteNoteRow[] = shown
    /* the building's first, then this unit's */
    .sort((a, b) => Number(a.unit !== null) - Number(b.unit !== null))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      words: r.words,
      unit: r.unit,
      by: nameOf(r),
      when: dayWords(todayInAu(new Date(r.written_at), tz), today),
      job: r.from_job_uuid ? { uuid: r.from_job_uuid, number: numbers.get(r.from_job_uuid) ?? null } : null,
      video: videoOf.get(r.id) ?? null,
    }));

  const jobs: SiteJobRow[] = here
    .filter((h) => h.job.uuid !== job.uuid)
    .map(({ job: j, site: s }) => {
      const what = firstLine(j.job_description) || "No description";
      return {
        uuid: j.uuid,
        number: j.generated_job_id,
        title: s.unit ? `${unitWords(s.unit)}: ${what}` : what,
        line: jobLine(j, today),
        open: !FINISHED.has((j.status ?? "").trim().toLowerCase()),
      };
    });

  return { noSite: false, street, place, unit: site.unit, notes, jobs, videos };
}

/* ---- writing ---- */

export type SiteWrite = { ok: true; id: string } | { ok: false; error: string };

type Writer = { orgId: string; userId: string; staffId: string | null };

function cleanWords(words: unknown): string | null {
  if (typeof words !== "string") return null;
  const w = words.replace(/\r/g, "").trim();
  return w && w.length <= SITE_NOTE_MAX ? w : null;
}

/** A clip this job holds, or null. */
async function videoOn(orgId: string, jobUuid: string, ref: unknown): Promise<string | null> {
  if (typeof ref !== "string" || !ref) return null;
  const choices = await videosOf(orgId, jobUuid, todayInAu());
  return choices.some((c) => c.ref === ref) ? ref : null;
}

export async function addSiteNoteFor(
  w: Writer,
  input: { jobUuid: string; kind: SiteNoteKind; words: unknown; whole: boolean; video?: unknown },
): Promise<SiteWrite> {
  const job = await jobOf(w.orgId, input.jobUuid);
  if (!job) return { ok: false, error: "That job isn't one of yours." };
  const site = siteOfJob(job);
  if (!site) return { ok: false, error: "The job's address doesn't name a building, so a note can't be kept on it." };
  const words = cleanWords(input.words);
  if (!words) return { ok: false, error: "Write the note first." };
  if (!input.whole && !site.unit) return { ok: false, error: "This job isn't at a unit." };
  const video = input.kind === "issue" ? await videoOn(w.orgId, job.uuid, input.video) : null;
  const { data, error } = await supabaseAdmin
    .from("site_notes")
    .insert({
      org_id: w.orgId,
      building_key: site.key,
      unit: input.whole ? null : site.unit,
      kind: input.kind,
      words,
      video,
      written_by: w.userId,
      written_by_staff: w.staffId,
      from_job_uuid: job.uuid,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "The note didn't save. Try again." };
  return { ok: true, id: (data as { id: string }).id };
}

/** A note this job shows, still current. */
async function shownNote(orgId: string, jobUuid: string, id: unknown): Promise<{ row: NoteRow & { replaces?: string }; site: Site; job: JobRow } | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const job = await jobOf(orgId, jobUuid);
  if (!job) return null;
  const site = siteOfJob(job);
  if (!site) return null;
  const { data } = await supabaseAdmin
    .from("site_notes")
    .select(NOTE_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", id)
    .is("replaced_at", null)
    .is("removed_at", null)
    .maybeSingle();
  const row = data as NoteRow | null;
  return row && shownOn(site)(row) ? { row, site, job } : null;
}

/** New words, a kind or a place for a note: a new row that replaces it, the
    old kept in history. */
export async function changeSiteNoteFor(
  w: Writer,
  input: { jobUuid: string; id: string; kind: SiteNoteKind; words: unknown; whole: boolean; video?: unknown },
): Promise<SiteWrite> {
  const found = await shownNote(w.orgId, input.jobUuid, input.id);
  if (!found) return { ok: false, error: "That note has changed since. Close and open Site notes again." };
  const words = cleanWords(input.words);
  if (!words) return { ok: false, error: "Write the note first." };
  if (!input.whole && !found.site.unit) return { ok: false, error: "This job isn't at a unit." };
  const { row, site, job } = found;
  const video = input.kind !== "issue" ? null : input.video === row.video ? row.video : await videoOn(w.orgId, job.uuid, input.video);
  const unit = input.whole ? null : site.unit;
  if (words === row.words && input.kind === row.kind && unit === row.unit && video === row.video) return { ok: true, id: row.id };

  /* the old one first, so two people changing it at once can't both win */
  const now = new Date().toISOString();
  const { data: took } = await supabaseAdmin
    .from("site_notes")
    .update({ replaced_at: now })
    .eq("org_id", w.orgId)
    .eq("id", row.id)
    .is("replaced_at", null)
    .is("removed_at", null)
    .select("id");
  if (!took || took.length === 0) return { ok: false, error: "That note has changed since. Close and open Site notes again." };
  const { data, error } = await supabaseAdmin
    .from("site_notes")
    .insert({
      org_id: w.orgId,
      building_key: site.key,
      unit,
      kind: input.kind,
      words,
      video,
      written_by: w.userId,
      written_by_staff: w.staffId,
      from_job_uuid: job.uuid,
      replaces: row.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    await supabaseAdmin.from("site_notes").update({ replaced_at: null }).eq("org_id", w.orgId).eq("id", row.id);
    return { ok: false, error: "The change didn't save. Try again." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function removeSiteNoteFor(w: Writer, input: { jobUuid: string; id: string }): Promise<SiteWrite> {
  const found = await shownNote(w.orgId, input.jobUuid, input.id);
  if (!found) return { ok: false, error: "That note has changed since. Close and open Site notes again." };
  const { data } = await supabaseAdmin
    .from("site_notes")
    .update({ removed_at: new Date().toISOString(), removed_by: w.userId })
    .eq("org_id", w.orgId)
    .eq("id", found.row.id)
    .is("replaced_at", null)
    .is("removed_at", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That note has changed since. Close and open Site notes again." };
  return { ok: true, id: found.row.id };
}

/* ---- old ServiceM8 notes with codes: a list to tick ---- */

type Sm8Note = {
  uuid: string;
  related_object_uuid: string;
  note: string | null;
  edit_by_staff_uuid: string | null;
  create_date: string | null;
};

/** Every old job note that likely holds a code, not yet filed, newest first.
    Plain text (site-notes.ts likelyCodeLines): nothing is read by a model. */
export async function readOldCodeNotesFor(orgId: string, tz: string | null): Promise<OldCodeNote[]> {
  const { data } = await supabaseAdmin
    .from("sm8_job_notes")
    .select("uuid, related_object_uuid, note, edit_by_staff_uuid, create_date")
    .eq("org_id", orgId)
    .eq("related_object", "job")
    .eq("active", 1)
    .filter("note", "imatch", OLD_NOTE_SEARCH)
    .order("create_date", { ascending: false })
    .limit(2000);
  const likely = ((data ?? []) as Sm8Note[])
    .map((n) => ({ n, words: likelyCodeLines(n.note ?? "") }))
    .filter((x): x is { n: Sm8Note; words: string } => !!x.words);
  if (likely.length === 0) return [];

  const [filed, jobs] = await Promise.all([
    supabaseAdmin
      .from("site_notes")
      .select("from_sm8_note_uuid")
      .eq("org_id", orgId)
      .in("from_sm8_note_uuid", likely.map((l) => l.n.uuid)),
    supabaseAdmin
      .from("sm8_jobs")
      .select(JOB_COLUMNS)
      .eq("org_id", orgId)
      .in("uuid", [...new Set(likely.map((l) => l.n.related_object_uuid))]),
  ]);
  const done = new Set(((filed.data ?? []) as { from_sm8_note_uuid: string }[]).map((f) => f.from_sm8_note_uuid));
  const jobById = new Map(((jobs.data ?? []) as JobRow[]).map((j) => [j.uuid, j]));
  const sm8Staff = [...new Set(likely.map((l) => l.n.edit_by_staff_uuid).filter((s): s is string => !!s))];
  const { data: people } = sm8Staff.length
    ? await supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", orgId).in("uuid", sm8Staff)
    : { data: [] };
  const nameOf = new Map(((people ?? []) as { uuid: string; first: string | null; last: string | null }[]).map((p) => [p.uuid, [p.first, p.last].filter(Boolean).join(" ").trim()]));
  const today = todayInAu(new Date(), tz);

  const out: OldCodeNote[] = [];
  for (const { n, words } of likely) {
    if (done.has(n.uuid)) continue;
    const job = jobById.get(n.related_object_uuid);
    if (!job) continue;
    const site = siteOfJob(job);
    if (!site) continue;
    out.push({
      uuid: n.uuid,
      words,
      note: (n.note ?? "").trim(),
      job: { uuid: job.uuid, number: job.generated_job_id, address: [(job.job_address ?? "").split("\n")[0]?.trim(), placeOf(job)].filter(Boolean).join(", ") },
      unit: site.unit,
      by: (n.edit_by_staff_uuid && nameOf.get(n.edit_by_staff_uuid)) || null,
      when: dayWords((n.create_date ?? "").slice(0, 10), today),
    });
  }
  return out;
}

export type FileOldResult = { filed: number; error: string | null };

/** Files the ticked notes as Access notes, each on its job's building or, for
    a unit's job that asked, the unit; written by whoever wrote the old note,
    on the day they wrote it. */
export async function fileOldCodeNotesFor(
  w: Writer,
  picks: readonly { uuid: string; words: unknown; whole: boolean }[],
): Promise<FileOldResult> {
  const wanted = picks.filter((p) => typeof p.uuid === "string" && p.uuid).slice(0, 300);
  if (wanted.length === 0) return { filed: 0, error: null };
  const { data } = await supabaseAdmin
    .from("sm8_job_notes")
    .select("uuid, related_object_uuid, note, edit_by_staff_uuid, create_date")
    .eq("org_id", w.orgId)
    .eq("related_object", "job")
    .in(
      "uuid",
      wanted.map((p) => p.uuid),
    );
  const notes = new Map(((data ?? []) as Sm8Note[]).map((n) => [n.uuid, n]));
  const { data: jobs } = await supabaseAdmin
    .from("sm8_jobs")
    .select(JOB_COLUMNS)
    .eq("org_id", w.orgId)
    .in("uuid", [...new Set([...notes.values()].map((n) => n.related_object_uuid))]);
  const jobById = new Map(((jobs ?? []) as JobRow[]).map((j) => [j.uuid, j]));
  const sm8Staff = [...new Set([...notes.values()].map((n) => n.edit_by_staff_uuid).filter((s): s is string => !!s))];
  const { data: links } = sm8Staff.length
    ? await supabaseAdmin
        .from("integration_links")
        .select("staff_profile_id, remote_id")
        .eq("org_id", w.orgId)
        .eq("provider", "servicem8")
        .eq("kind", "staff")
        .in("remote_id", sm8Staff)
    : { data: [] };
  const cardOf = new Map(((links ?? []) as { staff_profile_id: string | null; remote_id: string }[]).map((l) => [l.remote_id, l.staff_profile_id]));

  const rows = [];
  let skipped = 0;
  for (const p of wanted) {
    const n = notes.get(p.uuid);
    const job = n ? jobById.get(n.related_object_uuid) : undefined;
    const site = job ? siteOfJob(job) : null;
    const words = cleanWords(p.words);
    if (!n || !job || !site || !words) {
      skipped++;
      continue;
    }
    const at = (n.create_date ?? "").replace(" ", "T");
    rows.push({
      org_id: w.orgId,
      building_key: site.key,
      unit: p.whole || !site.unit ? null : site.unit,
      kind: "access" as const,
      words,
      written_by: n.edit_by_staff_uuid ? `sm8:${n.edit_by_staff_uuid}` : w.userId,
      written_by_staff: (n.edit_by_staff_uuid && cardOf.get(n.edit_by_staff_uuid)) || (n.edit_by_staff_uuid ? null : w.staffId),
      /* ServiceM8's stamp is the account's own clock, so only its day is
         sure: 02:00 UTC is that day from Perth to Auckland */
      written_at: /^\d{4}-\d{2}-\d{2}/.test(at) ? `${at.slice(0, 10)}T02:00:00Z` : new Date().toISOString(),
      from_job_uuid: job.uuid,
      from_sm8_note_uuid: n.uuid,
    });
  }
  /* filed once: one filed already, from another tab, is passed over (and the
     table's own index holds it if two land at once) */
  const { data: already } = rows.length
    ? await supabaseAdmin
        .from("site_notes")
        .select("from_sm8_note_uuid")
        .eq("org_id", w.orgId)
        .in(
          "from_sm8_note_uuid",
          rows.map((r) => r.from_sm8_note_uuid),
        )
    : { data: [] };
  const had = new Set(((already ?? []) as { from_sm8_note_uuid: string }[]).map((a) => a.from_sm8_note_uuid));
  const fresh = rows.filter((r) => !had.has(r.from_sm8_note_uuid));
  if (fresh.length === 0) return { filed: 0, error: skipped ? "None of those could be filed." : null };
  const { data: put, error } = await supabaseAdmin.from("site_notes").insert(fresh).select("id");
  if (error) return { filed: 0, error: "Those didn't file. Try again." };
  return { filed: (put ?? []).length, error: skipped ? `${skipped} couldn't be filed.` : null };
}
