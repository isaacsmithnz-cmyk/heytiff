import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { newId } from "@/lib/studio/document";
import { launchHeadless, printBase } from "@/lib/studio/pdf-render";
import { signPlanPagesTicket, signPlanReadTicket, type PlanPagesTicket } from "@/lib/studio/pdf-request";
import { mmPerPointOf, mmPerPxFor, printedScaleOf } from "@/lib/studio/plan-set";
import { scaleFromDimensions, type PlanReading, type PlanWord, type SheetReading } from "@/lib/studio/reading";
import { READING_MODEL, readDimensions, readRoof, readSchedule, readSheet, readSite, type SheetToRead, askWith, pngBlock } from "@/lib/studio/reading-server";
import { isSchedulePage, itemsOf, taggedFromWords, withSchedule, type ScheduleItem } from "@/lib/studio/schedule";
import { nameRooms, prepareMeasured } from "@/lib/studio/measured-server";
import { withMeasured } from "@/lib/studio/measure/merge";
import { K, vectorRooms } from "@/lib/studio/vector/read";
import { facesOf, snapped } from "@/lib/studio/vector/snap";
import { SONNET_FALLBACK } from "@/lib/tiff/sonnet-fallback";
import { openPdf } from "@/lib/tiff/extract";
import { fullInNode, pixelsInNode, previewsInNode, textsInNode, vectorsInNode } from "./plan-draw-node";
import { airPages, plainWords } from "./take-in";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import type { DrawnFull, DrawnPreview, PlanPagesAnswer } from "@/app/print/plan-pages/plan-pages";
import { chooseFloors, guessPageByWords, pageKey, stackLevels, stateOfRead, type JobPlan, type JobPlanKind, type SpecWords, type JobPlanPage, type JobPlanRead, type PageGuess, type PlanPageKind, type PlanPick, type PlanProgress , type PageWalled } from "./plans";
import { planRoomsOf, planRoomsSaid, type JobPlanRooms } from "./plan-rooms";

/* PLANS ON THE JOB, THE SERVER SIDE (lib/jobs/plans.ts says what a plan is).

   ADDING ONE is a row: which of the job's files, who pressed it, "reading".
   READING IT is the one read every design used to pay for on its own:

     1. the file is copied from the documents bucket into studio-plans, so
        the roof and the site reads can take the set whole as they do today;
     2. the headless Chrome draws every page small and reads each page's
        words (/print/plan-pages), since the server has no canvas;
     3. the words say which pages are floor plans and what level each is
        (guessPageByWords); where the words say nothing, Tiff looks at the
        small pages once and says;
     4. the floor pages are drawn in full, straight into the bucket;
     5. each floor is read (reading-server readSheet), the roof and the
        site off the whole set, and the reading is kept on the plan by page;
     6. the row says Read, Check the read or what went wrong.

   The row is written as each stage lands, so a page open on the job sees
   the plan's pages before its reading, and a read that dies half way says
   so rather than hanging on "Reading the plans". */

const PLANS_BUCKET = "studio-plans";
const SIGNED_SECONDS = 3600;
const PREVIEW_MIME = "image/jpeg";
const CLASSIFY_MODEL = "claude-sonnet-5-5";
/** a set past this many pages is classified off its words alone; Tiff is not shown forty pages */
const CLASSIFY_LOOK_CAP = 24;

type Row = {
  id: string;
  org_id: string;
  job_uuid: string;
  document_id: string | null;
  attachment_id: string | null;
  name: string;
  source_ref: string | null;
  source_kind: "pdf" | "image";
  kind?: JobPlanKind | null;
  page_count: number;
  pages: JobPlanPage[] | null;
  reading: PlanReading | null;
  state: JobPlan["state"];
  said: string | null;
  added_by: string | null;
  added_at: string;
  read_at: string | null;
  progress?: PlanProgress | null;
};
const COLS = "id, org_id, job_uuid, document_id, attachment_id, name, source_ref, source_kind, kind, page_count, pages, reading, state, said, added_by, added_at, read_at, progress";

const planOf = (r: Row, names: Map<string, string>): JobPlan => ({
  id: r.id,
  jobUuid: r.job_uuid,
  documentId: r.document_id,
  attachmentId: r.attachment_id,
  name: r.name,
  sourceRef: r.source_ref,
  sourceKind: r.source_kind === "image" ? "image" : "pdf",
  kind: r.kind === "spec" ? "spec" : "drawings",
  spec: (r.reading as { spec?: SpecWords } | null)?.spec ?? null,
  pageCount: r.page_count,
  pages: Array.isArray(r.pages) ? r.pages : [],
  reading: r.reading ?? null,
  state: r.state,
  said: r.said,
  addedBy: r.added_by ? (names.get(r.added_by) ?? null) : null,
  addedAt: r.added_at,
  readAt: r.read_at,
  progress: r.progress ?? null,
});

/* ── reading the job's plans, for its Documents and the Studio ── */

/** The job's plans, newest first, their thumbnails signed and the designs
    that took each counted. Null when they can't be read (a workspace whose
    job_plans table isn't there yet): the screens then offer no Plans at all,
    rather than an Add that can't land. */
export async function readJobPlans(orgId: string, jobUuid: string): Promise<JobPlanRead[] | null> {
  const { data, error } = await supabaseAdmin.from("job_plans").select(COLS).eq("org_id", orgId).eq("job_uuid", jobUuid).order("added_at", { ascending: false });
  if (error) return null;
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const [names, designs] = await Promise.all([
    staffDisplayNames(orgId, rows.map((r) => r.added_by)),
    supabaseAdmin.from("studio_designs").select("doc->planImport->>jobPlanId").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid),
  ]);
  const used = new Map<string, number>();
  for (const d of (designs.data ?? []) as { jobPlanId?: string | null }[]) {
    if (d.jobPlanId) used.set(d.jobPlanId, (used.get(d.jobPlanId) ?? 0) + 1);
  }
  const previews = rows.flatMap((r) => (Array.isArray(r.pages) ? r.pages : []).flatMap((p) => (p.preview ? [p.preview] : [])));
  const signed = new Map<string, string>();
  if (previews.length) {
    const { data: urls } = await supabaseAdmin.storage.from(PLANS_BUCKET).createSignedUrls(previews, SIGNED_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  return rows.map((r) => {
    const plan = planOf(r, names);
    const thumbs: Record<number, string> = {};
    for (const p of plan.pages) {
      const url = p.preview ? signed.get(p.preview) : undefined;
      if (url) thumbs[p.n] = url;
    }
    return { ...plan, thumbs, usedBy: used.get(plan.id) ?? 0 };
  });
}

/** One plan, for the read and for a poll. */
export async function readJobPlan(orgId: string, planId: string): Promise<JobPlan | null> {
  const { data } = await supabaseAdmin.from("job_plans").select(COLS).eq("org_id", orgId).eq("id", planId).maybeSingle();
  const row = data as Row | null;
  if (!row) return null;
  return planOf(row, await staffDisplayNames(orgId, [row.added_by]));
}

/* ── adding ── */

export type { PlanPick };

export type FileAt = { name: string; ref: string; mime: string | null; size?: number | null };

/** Where the picked file's bytes are, in the documents bucket: one of ours
    on this job, or ServiceM8's cached copy. Null when the file isn't this
    job's or its bytes aren't here yet. */
export async function fileFor(orgId: string, jobUuid: string, pick: PlanPick): Promise<FileAt | null> {
  if ("documentId" in pick) {
    const { data } = await supabaseAdmin
      .from("documents")
      .select("file_name, storage_ref, mime_type, size_bytes, sm8_job_uuid, uploaded_at")
      .eq("org_id", orgId)
      .eq("id", pick.documentId)
      .maybeSingle();
    const d = data as { file_name: string | null; storage_ref: string; mime_type: string | null; size_bytes: number | null; sm8_job_uuid: string | null; uploaded_at: string | null } | null;
    if (!d || d.sm8_job_uuid !== jobUuid || !d.uploaded_at) return null;
    return { name: d.file_name ?? "Plan", ref: d.storage_ref, mime: d.mime_type, size: d.size_bytes };
  }
  const [{ data: att }, { data: cached }] = await Promise.all([
    supabaseAdmin.from("sm8_attachments").select("attachment_name, file_type").eq("org_id", orgId).eq("uuid", pick.attachmentId).maybeSingle(),
    supabaseAdmin.from("documents").select("storage_ref, mime_type, size_bytes").eq("org_id", orgId).eq("source", "servicem8").eq("remote_ref", pick.attachmentId).not("uploaded_at", "is", null).maybeSingle(),
  ]);
  const a = att as { attachment_name: string | null; file_type: string | null } | null;
  const c = cached as { storage_ref: string; mime_type: string | null; size_bytes: number | null } | null;
  if (!a || !c) return null;
  return { name: a.attachment_name ?? "Plan", ref: c.storage_ref, mime: c.mime_type ?? (a.file_type === ".pdf" ? "application/pdf" : null), size: c.size_bytes };
}

export const kindOf = (f: FileAt): "pdf" | "image" | null => {
  const m = (f.mime ?? "").toLowerCase();
  if (m === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
  if (/^image\/(png|jpe?g|webp)$/.test(m) || /\.(png|jpe?g|webp)$/i.test(f.name)) return "image";
  return null;
};

/** A plan already on the job that is this same file under another upload:
    the same name and the same size. 3570, 20 November 2026: Luke's set went
    in twice, two identical rows in Plans. */
async function twinPlanOf(orgId: string, jobUuid: string, file: FileAt): Promise<string | null> {
  if (!file.size) return null;
  const { data } = await supabaseAdmin.from("job_plans").select("id, document_id, attachment_id").eq("org_id", orgId).eq("job_uuid", jobUuid).eq("name", file.name);
  for (const r of (data ?? []) as { id: string; document_id: string | null; attachment_id: string | null }[]) {
    const other = await fileFor(orgId, jobUuid, r.document_id ? { documentId: r.document_id } : { attachmentId: r.attachment_id ?? "" });
    if (other?.size === file.size) return r.id;
  }
  return null;
}

export type AddPlansResult = { ok: true; planIds: string[]; already: number } | { ok: false; error: string };

/** The picked files into the job's Plans, each a row in "reading"; a file
    already there is left as it is. The reads are started by the caller
    (readPlan), one route call each. A specification is a plan read by its
    words (take-in.ts says which a file is). */
export async function addJobPlans(orgId: string, jobUuid: string, picks: readonly PlanPick[], staffId: string | null, kind: JobPlanKind = "drawings"): Promise<AddPlansResult> {
  const planIds: string[] = [];
  let already = 0;
  for (const pick of picks.slice(0, 12)) {
    const file = await fileFor(orgId, jobUuid, pick);
    if (!file) return { ok: false, error: "That file isn't on this job, or isn't here yet." };
    const fileKind = kindOf(file);
    if (!fileKind) return { ok: false, error: `${file.name} isn't a PDF or a picture, so it can't be read as a plan.` };
    const have = await supabaseAdmin
      .from("job_plans")
      .select("id")
      .eq("org_id", orgId)
      .eq("job_uuid", jobUuid)
      .eq("documentId" in pick ? "document_id" : "attachment_id", "documentId" in pick ? pick.documentId : pick.attachmentId)
      .maybeSingle();
    if (have.data || (await twinPlanOf(orgId, jobUuid, file))) {
      already++;
      continue;
    }
    const id = newId("jplan");
    const { error } = await supabaseAdmin.from("job_plans").insert({
      id,
      org_id: orgId,
      job_uuid: jobUuid,
      document_id: "documentId" in pick ? pick.documentId : null,
      attachment_id: "attachmentId" in pick ? pick.attachmentId : null,
      name: file.name,
      source_kind: fileKind,
      ...(kind === "spec" ? { kind } : {}),
      state: "reading",
      added_by: staffId,
    });
    if (error) return { ok: false, error: "The plan couldn't be added. Try again." };
    planIds.push(id);
  }
  return { ok: true, planIds, already };
}

/** A plan put back to be read: its state reading, its reason and claim
    cleared. One that couldn't be read keeps whatever was drawn of it, and
    picks up there; one that was read is read afresh from its first page, so
    a better reader reads it whole (3570, 20 November 2026: read on the old
    floor-finding, its garage and cabana taken for the house). Not one being
    read, nor another job's; true when it was put back. The caller asks the
    read route for it (kickPlanReads). */
export async function readPlanAgain(orgId: string, jobUuid: string, planId: string): Promise<boolean> {
  const { data: row } = await supabaseAdmin.from("job_plans").select("state").eq("org_id", orgId).eq("job_uuid", jobUuid).eq("id", planId).maybeSingle();
  const was = (row as { state: string } | null)?.state;
  if (was !== "failed" && was !== "read" && was !== "check") return false;
  const afresh = was === "failed" ? {} : { pages: [], reading: null, page_count: 0, read_at: null };
  const { data, error } = await supabaseAdmin
    .from("job_plans")
    .update({ state: "reading", said: null, claimed_at: null, progress: null, ...afresh })
    .eq("org_id", orgId)
    .eq("job_uuid", jobUuid)
    .eq("id", planId)
    .eq("state", was)
    .select("id");
  return !error && (data ?? []).length > 0;
}

/* ── reading ── */

async function write(orgId: string, planId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("job_plans").update(patch).eq("org_id", orgId).eq("id", planId);
  if (error) throw new Error(`the plan couldn't be saved: ${error.message}`);
}

/** The file's own copy in the studio-plans bucket, made once. */
async function copySource(orgId: string, file: FileAt, kind: "pdf" | "image"): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(file.ref);
  if (error || !data) throw new Error("The file couldn't be fetched");
  const ext = kind === "pdf" ? "pdf" : /jpe?g/i.test(file.mime ?? "") || /\.jpe?g$/i.test(file.name) ? "jpeg" : "png";
  const ref = `org/${orgId}/${newId("plan")}.${ext}`;
  const put = await supabaseAdmin.storage.from(PLANS_BUCKET).upload(ref, Buffer.from(await data.arrayBuffer()), { contentType: kind === "pdf" ? "application/pdf" : `image/${ext}`, upsert: false });
  if (put.error) throw new Error(`The file couldn't be copied: ${put.error.message}`);
  return ref;
}

const DRAW_MS = 240_000;

/** The set's own copy, as the server holds it, to hand to the browser. */
export type SourceFile = { bytes: Buffer; type: string };

/** How much of a set goes to the headless page at a time. */
const FILE_CHUNK = 2 * 1024 * 1024;

async function sourceFile(sourceRef: string, kind: "pdf" | "image"): Promise<SourceFile> {
  const { data, error } = await supabaseAdmin.storage.from(PLANS_BUCKET).download(sourceRef);
  if (error || !data) throw new Error("The file couldn't be fetched");
  const type = kind === "pdf" ? "application/pdf" : /\.jpe?g$/i.test(sourceRef) ? "image/jpeg" : "image/png";
  return { bytes: Buffer.from(await data.arrayBuffer()), type };
}

/** What a failed request in the headless browser said, its address cut to its path. */
const failedLine = (url: string, why: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.slice(0, 60)}: ${why}`;
  } catch {
    return why;
  }
};

/** One visit of the headless browser to /print/plan-pages. The file itself
    is handed to the page from here: the page asks for its signed address,
    and the browser is answered with the bytes the server already holds, so
    nothing rides the headless browser's own network but the page. Fetched
    by Vercel's Chromium, an 11 MB set (Luke's 307 Coonawarra Rd, bug 51,
    19 November 2026) failed in under a second with "Failed to fetch" while
    Supabase logged its 200; every plan read in production till then was a
    photo under 1 MB. A request that fails anyway is named in the error. */
export async function draw(ticket: PlanPagesTicket, origin: string, file?: SourceFile, onProgress?: (done: number, total: number) => void): Promise<PlanPagesAnswer> {
  const browser = await launchHeadless();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(DRAW_MS);
    /* the page says each page it has drawn, for the bar under the plan */
    if (onProgress) await page.exposeFunction("__htProgress", (done: number, total: number) => onProgress(Number(done) || 0, Number(total) || 0));
    const failures: string[] = [];
    page.on("requestfailed", (r) => {
      if (r.url() !== ticket.url || !file) failures.push(failedLine(r.url(), r.failure()?.errorText ?? "failed"));
    });
    if (file) {
      /* the set's bytes handed to the page in pieces, off the network
         altogether: on Vercel's headless Chrome an 11 MB body couldn't be
         taken in, fetched (#1621's "Failed to fetch") or handed over whole
         ("reading the file: Failed to fetch", 3570, 20 November 2026) */
      await page.exposeFunction("__htFileSize", () => file.bytes.length);
      await page.exposeFunction("__htFileChunk", (i: number) => file.bytes.subarray(i * FILE_CHUNK, (i + 1) * FILE_CHUNK).toString("base64"));
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        if (r.isInterceptResolutionHandled()) return;
        if (r.url() === ticket.url && r.method() === "GET")
          void r.respond({ status: 200, contentType: file.type, headers: { "access-control-allow-origin": "*", "cache-control": "no-store" }, body: file.bytes });
        else void r.continue();
      });
    }
    const url = new URL("/print/plan-pages", printBase(origin));
    url.searchParams.set("t", signPlanPagesTicket(ticket));
    const res = await page.goto(url.toString(), { waitUntil: "load", timeout: 60_000 });
    if (!res || !res.ok()) throw new Error(`the plan page answered ${res?.status() ?? "nothing"}`);
    await page.waitForFunction("window.__htPdfReady === true", { timeout: DRAW_MS });
    const out = (await page.evaluate("({ pages: window.__htPlanPages ?? null, error: window.__htPlanPagesError ?? null })")) as { pages: PlanPagesAnswer | null; error: string | null };
    if (out.error) throw new Error(failures.length ? `${out.error} (${failures.slice(0, 3).join("; ")})` : out.error);
    if (!out.pages) throw new Error("the pages didn't come back");
    return out.pages;
  } finally {
    await browser.close();
  }
}

/** Past this, a read stops at the end of a stage and hands the rest to a
    fresh run: the route has 300 s, and the read of the floors, the roof
    and the site wants a run of its own on a big set. */
const HANDOFF_MS = 90_000;
/* THE FLOORS READ BY MEASURE, a stage of their own (measured-server.ts): two
   questions a floor, about three minutes for a big one, every floor at once.
   It starts only with most of the route's five minutes still ahead of it,
   and always hands on when it is done, so the read that follows has five
   minutes of its own. For a PDF set: the walls need a drawing, and a photo
   has none to measure (a scanned set finds no walls and is read by picture
   as before). OFF unless PLANS_MEASURED=1: on 3570 it found fewer rooms than
   the read by picture (63 of 68 against 67) with sides only a little closer,
   and it had never run on a real plan (the re-test and the outside review,
   21–22 November 2026). It stays for the kept test until it beats the
   picture read. */
const MEASURE_ROOM_MS = 30_000;
const measuredOn = () => process.env.PLANS_MEASURED === "1";
/* THE ROOMS READ FROM THE DRAWING FILE ITSELF (lib/studio/vector): where the
   file draws its walls as filled shapes, they are the walls, and the rooms
   are the spaces they close off, named by the plan's own words. Exact, about
   half a second a floor, and no model. A floor it can't read surely (walls
   drawn in lines, a scanned sheet, room names that don't land in rooms) is
   read by picture as before. PLANS_VECTOR=0 turns it off without a deploy. */
const vectorOn = () => process.env.PLANS_VECTOR !== "0";
/** how fine a floor is drawn to measure: about 17 mm of building a pixel, a wall a dozen pixels thick */
const MEASURE_MM = 17.5;

/** When the stage must be done by, from the run's start: the route is killed
    at 300 s with nothing saved, and the pages still have to be written and
    handed on (7 Cutler Rd's level took 303 s on its own; the engine's review,
    21 November 2026). */
const MEASURE_BY_MS = 250_000;
/** What a floor's page says until its measuring lands: a run killed part-way
    (out of time, out of memory) leaves it, and the next run reads that floor
    by picture instead of measuring the set again and dying the same way. */
const NOT_FINISHED = "The measuring didn't finish";

/* `oneAtATime` runs what it is given one after another: a floor drawn to
   measure is 65 MB of pixels twice over, so the floors are drawn and their
   walls found in turn, and only the questions that follow overlap. The
   pixels are let go before the first question (prepareMeasured). */
async function measureFloor(bytes: Uint8Array, p: JobPlanPage, deadline: number, oneAtATime: <T>(fn: () => Promise<T>) => Promise<T>): Promise<PageWalled> {
  /* the scale somebody set, else the title block's "1:100 @ A1" */
  const known = (p.set && p.set.mmPerPx > 0 ? p.set.mmPerPx : null) ?? p.mmPerPx;
  let why: string | null = null;
  if (vectorOn()) {
    const v = await oneAtATime(() => vectorsInNode(bytes, p.n)).catch((e) => {
      console.error(`[job-plans] p${p.n} vectors: ${String(e)}`);
      return null;
    });
    if (v) {
      /* the scale: one set or printed, in the raster's pixels, else the bare "1 : 100" on a paper-sized page */
      const ratio = known ? null : mmPerPointOf(v.words.map((w) => ({ ...w, at: { x: w.at.x / K, y: w.at.y / K } })), { width: v.width, height: v.height });
      const mmPerPt = known ? known * v.rasterScale : (ratio?.mmPerPt ?? null);
      const read = vectorRooms({ fills: v.fills, lines: v.lines, width: v.width, height: v.height, words: v.words, mmPerPt, rasterScale: v.rasterScale });
      if (!("none" in read)) return { spaces: read.spaces, look: read.look, grid: read.grid, rounds: read.rounds, frame: read.frame, from: "file" };
      why = read.none;
    }
  }
  if (!measuredOn()) return { none: why ?? "Its walls couldn't be read from the file" };
  const times = known ? Math.min(2, Math.max(1, Math.round(known / MEASURE_MM))) : 2;
  const ready = await oneAtATime(async () => {
    const px = await pixelsInNode(bytes, p.n, times);
    /* else the ratio it prints alone ("1 : 100") on a page that is a paper
       size: without a scale the walls' sizes are guessed from the page's
       width, two to four times out on most sheets */
    const ratio = known ? null : mmPerPointOf(px.words, { width: px.width / px.scale, height: px.height / px.scale });
    const mm = known ?? (ratio ? (ratio.mmPerPt / px.scale) * times : null);
    return prepareMeasured({ rgba: px.rgba, width: px.width, height: px.height, words: px.words }, times, mm);
  });
  if (!ready) return { none: "Its walls aren't drawn as a fill, so they couldn't be measured" };
  const read = await nameRooms(ready, {
    floorName: p.name || `page ${p.n}`,
    deadline,
    ask: (pictures, text, schema, maxTokens) => askWith(pictures.map(pngBlock), text, schema, maxTokens, undefined, "medium"),
  });
  if (!read) return { none: "Its rooms couldn't be named between its walls" };
  return { spaces: read.spaces, look: read.problems, grid: read.walls.grid, rounds: read.rounds, frame: read.frame };
}


/** At most this many schedule sheets are read: a set's schedules are a page or two. */
const SCHEDULE_PAGES = 3;

/* THE SET'S DOOR AND WINDOW SCHEDULE (lib/studio/schedule.ts): the pages
   that schedule them found by their words, each drawn and read once, every
   mark with its size. */
async function schedulesOf(bytes: Uint8Array, pages: readonly JobPlanPage[]): Promise<{ pages: number[]; items: ScheduleItem[] }> {
  const others = pages.filter((p) => p.kind !== "floor").map((p) => p.n);
  if (!others.length) return { pages: [], items: [] };
  const found = (await textsInNode(bytes, others)).filter((t) => isSchedulePage(t.words)).map((t) => t.n).slice(0, SCHEDULE_PAGES);
  if (!found.length) return { pages: [], items: [] };
  const drawn = await fullInNode(bytes, found);
  const per = await Promise.all(
    drawn.map((d) =>
      readSchedule(d.png, d.words ?? [])
        .then((raw) => itemsOf(raw, d.n))
        .catch((e) => {
          console.error(`[job-plans] schedule p${d.n}: ${String(e)}`);
          return [] as ScheduleItem[];
        }),
    ),
  );
  return { pages: found, items: per.flat() };
}

/** How far a side read by picture may move onto the drawing's wall face. */
const SNAP_MM = 450;

/* A FLOOR READ BY PICTURE, ITS ROOMS ON THE DRAWING'S OWN WALLS
   (lib/studio/vector/snap.ts): each square side moved onto the face of the
   wall the file draws along it. On 3570's level 1 the sides on the true face
   to within 30 mm went from 21 of 70 to 48 (22 November 2026). */
async function onTheLines(bytes: Uint8Array, p: JobPlanPage, sheet: SheetReading): Promise<SheetReading> {
  const v = await vectorsInNode(bytes, p.n);
  const known = (p.set && p.set.mmPerPx > 0 ? p.set.mmPerPx : null) ?? p.mmPerPx;
  const ratio = known ? null : mmPerPointOf(v.words.map((w) => ({ ...w, at: { x: w.at.x / K, y: w.at.y / K } })), { width: v.width, height: v.height });
  /* at an unknown scale, 1:100: what is a wall and how far a side moves are guessed from it */
  const mmPerPt = known ? known * v.rasterScale : (ratio?.mmPerPt ?? 35.28);
  const faces = facesOf(v.lines, v.fills, 300 / mmPerPt, 70 / mmPerPt, 650 / mmPerPt);
  return { ...sheet, spaces: snapped(sheet.spaces, faces, v.rasterScale, SNAP_MM / mmPerPt).spaces };
}

/** The read route asked for a plan by the server itself, and let go once
    it has the request: the read writes its row as it goes. */
async function askReadRoute(orgId: string, planId: string, origin: string): Promise<void> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 4_000);
  await fetch(new URL("/api/jobs/plans/read", printBase(origin)), {
    method: "POST",
    headers: { "content-type": "application/json", "x-plan-read": signPlanReadTicket({ orgId, planId }) },
    body: JSON.stringify({ planId }),
    signal: stop.signal,
  }).catch(() => {});
  clearTimeout(timer);
}

/* ── how far a read has got ── */

/** How far a read has got, written for the bar under the plan: never fails
    the read, and the page drawing's many reports go at most every second
    and a half, with the last always written. */
function progressWriter(orgId: string, planId: string): (p: PlanProgress) => void {
  let last = 0;
  let queued: PlanProgress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = (p: PlanProgress) => {
    last = Date.now();
    void supabaseAdmin
      .from("job_plans")
      .update({ progress: { ...p, at: new Date().toISOString() } })
      .eq("org_id", orgId)
      .eq("id", planId)
      .then(
        () => {},
        () => {},
      );
  };
  let step: PlanProgress["step"] | null = null;
  return (p) => {
    /* a new step, or a step's last, is written at once */
    const now = p.step !== step || (p.total > 0 && p.done >= p.total);
    step = p.step;
    if (now || Date.now() - last >= 1500) {
      if (timer) clearTimeout(timer);
      timer = null;
      queued = null;
      send(p);
      return;
    }
    queued = p;
    timer ??= setTimeout(() => {
      timer = null;
      if (queued) send(queued);
      queued = null;
    }, 1500);
  };
}

/* ── which pages are floors ── */

const KINDS: PlanPageKind[] = ["floor", "site", "roof", "elevation", "section", "other"];

/** Tiff looks at the small pages once and says what each is, for a set
    whose words don't say (a scan, a photographed set). */
async function guessPagesByLook(previews: readonly DrawnPreview[], client: Anthropic): Promise<Map<number, PageGuess>> {
  const shown = previews.slice(0, CLASSIFY_LOOK_CAP);
  const blocks: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  for (const p of shown) {
    blocks.push({ type: "text", text: `Page ${p.n}:` });
    blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.jpeg.replace(/^data:[^,]*,/, "") } });
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["pages"],
    properties: {
      pages: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["page", "kind", "level_name", "level"],
          properties: {
            page: { type: "number" },
            kind: { type: "string", enum: KINDS },
            level_name: { type: "string", description: 'for a floor plan, the level as the set names it: "Ground floor", "Level 1", "Basement"; else ""' },
            level: { type: "number", description: "for a floor plan, its place in the stack: the ground 0, the floor above 1, a basement -1; else 0" },
          },
        },
      },
    },
  };
  const text =
    `These are the pages of a building's drawing set, small. For each page say what it is: a floor plan (the rooms of one level, seen from above), a site plan, a roof plan, elevations, sections, or other (a cover, notes, details, a schedule, electrical or drainage, a demolition plan). ` +
    `A floor plan of the existing building before the work is "other"; only the proposed floors are floor plans. Give one entry per page, in order.`;
  const response = await client.beta.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 4000,
    ...SONNET_FALLBACK,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: [...blocks, { type: "text", text }] }],
  });
  const block = [...response.content].reverse().find((b) => b.type === "text");
  const raw = block && block.type === "text" ? (JSON.parse(block.text) as { pages?: { page: number; kind: string; level_name: string; level: number }[] }) : {};
  const out = new Map<number, PageGuess>();
  for (const p of raw.pages ?? []) {
    const kind = (KINDS as string[]).includes(p.kind) ? (p.kind as PlanPageKind) : "other";
    out.set(p.page, { kind, name: kind === "floor" ? p.level_name.trim() || "" : "", level: kind === "floor" ? Math.round(Number(p.level) || 0) : null });
  }
  return out;
}

/** Every page's kind: by its words, then by a look where the words decide
    nothing for any page, then "other". A picture is one floor plan. */
async function classify(kind: "pdf" | "image", previews: readonly DrawnPreview[], client: Anthropic): Promise<Map<number, PageGuess>> {
  const out = new Map<number, PageGuess>();
  if (kind === "image") {
    out.set(1, { kind: "floor", name: "Ground floor", level: 0 });
    return out;
  }
  let decided = 0;
  for (const p of previews) {
    const g = guessPageByWords(p.words);
    if (g) {
      out.set(p.n, g);
      decided++;
    }
  }
  if (decided < previews.length) {
    /* the pages the words left undecided, looked at, whatever else was found:
       a set's own floors can be the ones its words don't name (3570's LGF,
       GF and FF, beside a garage's "ground floor plan" the words did) */
    const looked = await guessPagesByLook(previews.filter((p) => !out.has(p.n)), client).catch((e) => {
      console.error(`[job-plans] the look at the pages failed: ${String(e)}`);
      return new Map<number, PageGuess>();
    });
    for (const [n, g] of looked) if (!out.has(n) || (out.get(n)!.kind !== "floor" && g.kind === "floor")) out.set(n, g);
  }
  for (const p of previews) if (!out.has(p.n)) out.set(p.n, { kind: "other", name: "", level: null });
  return out;
}

/* ── the scale off a page's printed dimensions ── */

/** The floor pages with no printed scale, each given the scale its own
    dimension lines print (plans.ts `measured`), looked for once: a page
    looked at before, with or without a find, is left as it is. A read that
    fails leaves the page unlooked, for the next ask. */
async function measurePages(orgId: string, pages: readonly JobPlanPage[], photo: boolean): Promise<JobPlanPage[]> {
  return Promise.all(
    pages.map(async (p): Promise<JobPlanPage> => {
      /* a page somebody set the scale on has nothing left to look for */
      if (p.kind !== "floor" || !p.ref || p.mmPerPx || p.set || p.measured !== undefined) return p;
      try {
        const dims = await readDimensions(orgId, { floorId: pageKey(p.n), floorName: p.name || `Page ${p.n}`, sheetId: pageKey(p.n), ref: p.ref, ...(p.trim ? { crop: p.trim } : {}), mmPerPx: null, photo });
        return { ...p, measured: scaleFromDimensions(dims, p) };
      } catch (e) {
        console.error(`[job-plans] page ${p.n} dimensions: ${String(e)}`);
        return p;
      }
    }),
  );
}

/* ── a scale set by hand (Set scale, Check scale) ── */

export type PageForScale = { url: string; width: number; height: number; at: { a: { x: number; y: number }; b: { x: number; y: number }; mm: number } | null };

/** A floor page's full picture, signed, for Set scale; with it the figure a
    one-figure scale rests on, or the length somebody set before, so Check
    scale opens on it. Null when the page isn't a floor of this job's plan. */
export async function planPageForScale(orgId: string, jobUuid: string, planId: string, n: number): Promise<PageForScale | null> {
  const plan = await readJobPlan(orgId, planId);
  const page = plan && plan.jobUuid === jobUuid ? plan.pages.find((p) => p.n === n && p.kind === "floor" && p.ref) : null;
  if (!page?.ref) return null;
  const { data } = await supabaseAdmin.storage.from(PLANS_BUCKET).createSignedUrl(page.ref, SIGNED_SECONDS);
  if (!data?.signedUrl) return null;
  const at = page.set?.a && page.set.b && page.set.mm ? { a: page.set.a, b: page.set.b, mm: page.set.mm } : (page.measured?.at ?? null);
  return { url: data.signedUrl, width: page.width, height: page.height, at };
}

/** the shortest line a scale may be set from, in the page's pixels: a
    shorter one makes every room's error large */
const SET_SPAN_PX = 20;

/** The scale somebody set on a page, kept on the job's plan, so every
    design, heat load and quote sizes its rooms by it (Isaac, 14 November
    2026, the mock https://claude.ai/artifact/61nqwanqUAtQx4iG6AxoYs: Set
    scale, "Saved on the job's plan"). Two points on the page and the length
    between them, or the scale a design measured on its floor. Returns why
    it couldn't be saved, or null once it is. */
export async function setPlanScale(
  orgId: string,
  planId: string,
  n: number,
  how: { a: { x: number; y: number }; b: { x: number; y: number }; mm: number } | { mmPerPx: number },
  staffId: string | null,
  jobUuid?: string,
): Promise<string | null> {
  const plan = await readJobPlan(orgId, planId);
  const page = plan && (!jobUuid || plan.jobUuid === jobUuid) ? plan.pages.find((p) => p.n === n && p.kind === "floor" && p.ref) : null;
  if (!plan || !page) return "That page isn't one of this job's floor plans.";
  let mmPerPx: number;
  let rest: { mm: number | null; a?: { x: number; y: number }; b?: { x: number; y: number } };
  if ("mmPerPx" in how) {
    mmPerPx = how.mmPerPx;
    rest = { mm: null };
  } else {
    const span = Math.hypot(how.b.x - how.a.x, how.b.y - how.a.y);
    if (!(span >= SET_SPAN_PX)) return "The two points are too close together.";
    mmPerPx = how.mm / span;
    rest = { mm: how.mm, a: { x: how.a.x, y: how.a.y }, b: { x: how.b.x, y: how.b.y } };
  }
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return "That length can't be used.";
  const by = staffId ? ((await staffDisplayNames(orgId, [staffId])).get(staffId) ?? null) : null;
  const set = { mmPerPx, ...rest, by, at: new Date().toISOString() };
  try {
    await write(orgId, planId, { pages: plan.pages.map((p) => (p.n === n ? { ...p, set } : p)) });
    return null;
  } catch {
    return "The scale couldn't be saved. Try again.";
  }
}

/** The floors somebody chose for a set's pages in the Plans dialog, kept on
    the plan, and the plan's state worked out again: a page they've looked at
    is no longer one to check. Null once saved, or the reason. */
export async function choosePlanFloors(orgId: string, planId: string, chosen: Readonly<Record<number, string>>, staffId: string | null, jobUuid?: string): Promise<string | null> {
  const plan = await readJobPlan(orgId, planId);
  if (!plan || (jobUuid && plan.jobUuid !== jobUuid) || plan.kind === "spec") return "That isn't one of this job's plans.";
  if (plan.state !== "read" && plan.state !== "check") return "Its floors can be chosen once Tiff has read it.";
  const by = staffId ? ((await staffDisplayNames(orgId, [staffId])).get(staffId) ?? null) : null;
  const pages = chooseFloors(plan.pages, chosen, by, new Date().toISOString());
  const { state, said } = stateOfRead(pages, plan.reading);
  try {
    await write(orgId, planId, { pages, state, said });
    return null;
  } catch {
    return "The floors couldn't be saved. Try again.";
  }
}

/** A subfloor's height typed in a design, kept on the job's plan it was read
    off, so the job says it and the next design and quote start with it (the
    mock https://claude.ai/artifact/B2Cr5YiUkZG7eSrsLd8Uum). */
export async function keepSubfloorHeight(orgId: string, planId: string, heightMm: number, staffId: string | null, design: string, jobUuid?: string): Promise<string | null> {
  const plan = await readJobPlan(orgId, planId);
  if (!plan || (jobUuid && plan.jobUuid !== jobUuid)) return "That isn't one of this job's plans.";
  const sub = plan.reading?.roof?.subfloor;
  if (!plan.reading?.roof || !sub || sub.shown !== "drawn") return "The plan has no subfloor to keep a height on.";
  const by = staffId ? ((await staffDisplayNames(orgId, [staffId])).get(staffId) ?? null) : null;
  const reading = { ...plan.reading, roof: { ...plan.reading.roof, subfloor: { ...sub, set: { heightMm, by: by?.split(" ")[0] ?? null, design: design.slice(0, 120), at: new Date().toISOString() } } } };
  try {
    await write(orgId, planId, { reading });
    return null;
  } catch {
    return "The height couldn't be kept on the job. Try again.";
  }
}

/* ── the rooms off the job's plans, for a quote and the heat load ── */

/** how long an ask waits on a read it started before saying it's still going */
const READ_WAIT_MS = 150_000;
/** a plan left "reading" this long was dropped mid-read: the next ask picks it up */
const STALE_MS = 6 * 60_000;

/** The rooms off the job's plans, by plan and floor, with their sizes
    (plan-rooms.ts). `add` puts one of the job's files into its Plans first
    and reads it, as pressing Add plans does, once: a file already there is
    left as it is. A plan read before the dimension read existed gets its
    scale looked for here, once. `origin` is where the headless browser draws
    the pages: without it nothing can be added or picked up. */
export async function jobPlanRooms(orgId: string, jobUuid: string, opts: { add?: PlanPick; origin?: string | null } = {}): Promise<JobPlanRooms | string> {
  let toRead: string[] = [];
  if (opts.add) {
    if (!opts.origin) return "A plan can't be read from here: add it to the job's Plans from its Documents.";
    const added = await addJobPlans(orgId, jobUuid, [opts.add], null);
    if (!added.ok) return added.error;
    toRead = added.planIds;
  }
  const { data, error } = await supabaseAdmin.from("job_plans").select(COLS).eq("org_id", orgId).eq("job_uuid", jobUuid).order("added_at", { ascending: true });
  if (error) return "This workspace's Plans can't be read just now.";
  let plans = ((data ?? []) as Row[]).map((r) => planOf(r, new Map()));
  /* a read dropped mid-way is picked up, with the one just added */
  const origin = opts.origin;
  if (origin) for (const p of plans) if (p.state === "reading" && !toRead.includes(p.id) && Date.now() - new Date(p.addedAt).getTime() > STALE_MS) toRead.push(p.id);
  if (origin && toRead.length) {
    const reads = Promise.all(toRead.map((id) => readPlan(orgId, id, origin).catch(() => null)));
    await Promise.race([reads, new Promise((done) => setTimeout(done, READ_WAIT_MS))]);
  }
  /* a plan read before its dimensions were: its scale, looked for once */
  await Promise.all(
    plans.map(async (p) => {
      if (p.state !== "read" && p.state !== "check") return;
      if (!p.pages.some((pg) => pg.kind === "floor" && pg.ref && !pg.mmPerPx && !pg.set && pg.measured === undefined)) return;
      const pages = await measurePages(orgId, p.pages, p.sourceKind === "image");
      if (pages.some((pg, i) => pg !== p.pages[i])) await write(orgId, p.id, { pages }).catch(() => {});
    }),
  );
  if (toRead.length || plans.some((p) => p.pages.some((pg) => pg.kind === "floor" && pg.ref && !pg.mmPerPx && !pg.set && pg.measured === undefined))) {
    const again = await supabaseAdmin.from("job_plans").select(COLS).eq("org_id", orgId).eq("job_uuid", jobUuid).order("added_at", { ascending: true });
    if (!again.error) plans = ((again.data ?? []) as Row[]).map((r) => planOf(r, new Map()));
  }
  const rooms = plans.map(planRoomsOf);
  return { plans: rooms, said: planRoomsSaid(rooms) };
}

/* ── the read ── */

/** `finished` when this run wrote the read: the job's scope is then written
    again from it (api/jobs/plans/read). */
export type ReadPlanOutcome = { ok: true; state: JobPlan["state"]; finished?: { jobUuid: string } } | { ok: false; error: string };

/** A read claimed before it starts, for ten minutes: an upload's own read
    and a press of Add plans asking at once pay for one. A workspace whose
    job_plans has no claimed_at yet reads as before. */
async function claimRead(orgId: string, planId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("job_plans")
    .update({ claimed_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", planId)
    .eq("state", "reading")
    .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)
    .select("id");
  if (error) return true;
  return (data ?? []).length > 0;
}

/** The most of a specification's words kept for the supplied scope. */
const SPEC_WORDS_MAX = 80_000;

/** A specification, read by its own words: the pages on the air kept with
    their words for the supplied scope, and nothing drawn or asked of Tiff. */
async function readSpec(orgId: string, planId: string, file: FileAt): Promise<ReadPlanOutcome> {
  const { data: blob, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(file.ref);
  if (error || !blob) {
    await write(orgId, planId, { state: "failed", said: "The file couldn't be opened" });
    return { ok: false, error: "The file couldn't be opened" };
  }
  const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
  try {
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) texts.push(await doc.pageText(n));
    const pages = airPages(texts);
    const words = pages.map((n) => `[page ${n}]\n${plainWords(texts[n - 1] ?? "")}`).join("\n\n").slice(0, SPEC_WORDS_MAX);
    const spec: SpecWords = { pages, words };
    const reading = { at: new Date().toISOString(), model: "words", floors: {}, failed: [], spec };
    const state = pages.length ? "read" : "check";
    await write(orgId, planId, { reading, pages: [], page_count: doc.numPages, state, said: pages.length ? null : "No page names the air conditioning, ventilation or exhaust", read_at: new Date().toISOString() });
    return { ok: true, state };
  } finally {
    await doc.destroy();
  }
}

/** Tiff reads a plan: its pages drawn, the floors found, each read, the
    roof and the site off the set, the row written as it goes. Only what is
    missing is done: a plan whose pages are drawn goes straight to the read,
    a plan read before is left as it is. */
export async function readPlan(orgId: string, planId: string, origin: string, client: Anthropic = new Anthropic()): Promise<ReadPlanOutcome> {
  const plan = await readJobPlan(orgId, planId);
  if (!plan) return { ok: false, error: "That plan isn't on the job." };
  if (plan.reading && plan.state !== "reading") return { ok: true, state: plan.state };
  /* two doors asking at once pay for one read */
  if (!(await claimRead(orgId, planId))) return { ok: true, state: plan.state };
  const pick: PlanPick = plan.documentId ? { documentId: plan.documentId } : { attachmentId: plan.attachmentId ?? "" };
  const failed = async (why: string): Promise<ReadPlanOutcome> => {
    await write(orgId, planId, { state: "failed", said: why }).catch(() => {});
    return { ok: false, error: why };
  };
  const tell = progressWriter(orgId, planId);
  const started = Date.now();
  /* the rest of the read to a fresh run of the route: the claim let go,
     the route asked with a signed ticket, this run done */
  const handOff = async (): Promise<ReadPlanOutcome> => {
    await supabaseAdmin.from("job_plans").update({ claimed_at: null }).eq("org_id", orgId).eq("id", planId);
    await askReadRoute(orgId, planId, origin);
    return { ok: true, state: "reading" };
  };
  try {
    const file = await fileFor(orgId, plan.jobUuid, pick);
    if (!file) return failed("The file isn't on the job any more.");
    if (plan.kind === "spec") {
      const out = await readSpec(orgId, planId, file);
      return out.ok ? { ...out, finished: { jobUuid: plan.jobUuid } } : out;
    }
    /* 1. the set's own copy */
    const sourceRef = plan.sourceRef ?? (await copySource(orgId, file, plan.sourceKind));
    if (!plan.sourceRef) await write(orgId, planId, { source_ref: sourceRef });
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from(PLANS_BUCKET).createSignedUrl(sourceRef, SIGNED_SECONDS);
    if (signErr || !signed) return failed("The file couldn't be opened for drawing.");

    /* 2 to 4 in stages, each saved before the next, so a read the server
       cut off picks up where it stopped: the pages drawn small and the
       floors found among them; the floors drawn in full; then the read. A
       PDF is drawn in Node (plan-draw-node.ts), the headless browser its
       fallback and a photo's way in. A run past HANDOFF_MS at the end of a
       stage hands the rest to a fresh run of the read route, so a big set
       never meets the route's five minutes in one go (3570, 20 November
       2026: 27 A1 sheets, 11 MB). */
    let pages = plan.pages;
    const isPdf = plan.sourceKind === "pdf";
    let source: SourceFile | null = null;
    const bytesOf = async () => (source ??= await sourceFile(sourceRef, plan.sourceKind));
    const signedUrl = signed.signedUrl;

    /* 2. the pages drawn small, which of them are floors, saved */
    if (pages.length === 0) {
      tell({ step: "drawing", done: 0, total: 0 });
      const report = (done: number, total: number) => tell({ step: "drawing", done, total });
      const file = await bytesOf();
      let previews: DrawnPreview[] | null = null;
      if (isPdf)
        previews = await previewsInNode(new Uint8Array(file.bytes), report).catch((e) => {
          console.error(`[job-plans] ${planId}/node pages: ${String(e)}`);
          return null;
        });
      previews ??= (await draw({ orgId, url: signedUrl, kind: plan.sourceKind }, origin, file, report)).previews ?? [];
      if (previews.length === 0) return failed("No pages could be drawn from the file.");
      tell({ step: "finding", done: 0, total: 1 });
      const guesses = await classify(plan.sourceKind, previews, client);
      const floors = stackLevels(previews.map((p) => ({ n: p.n, ...guesses.get(p.n)! }))).filter((p) => p.kind === "floor");
      /* the floors' small pictures, for the row's thumbnails */
      const previewRefs = new Map<number, string>();
      for (const f of floors) {
        const pv = previews.find((p) => p.n === f.n)!;
        const ref = `org/${orgId}/${newId("plan")}.jpeg`;
        const put = await supabaseAdmin.storage.from(PLANS_BUCKET).upload(ref, Buffer.from(pv.jpeg.replace(/^data:[^,]*,/, ""), "base64"), { contentType: PREVIEW_MIME, upsert: false });
        if (!put.error) previewRefs.set(f.n, ref);
      }
      pages = previews.map((pv): JobPlanPage => {
        const g = floors.find((f) => f.n === pv.n) ?? guesses.get(pv.n) ?? { kind: "other" as const, name: "", level: null };
        const floor = g.kind === "floor";
        /* a floor's words are where they sit on its full drawing, which is the size given */
        const words = floor ? ((pv.words ?? []) as PlanWord[]) : [];
        const scale = floor ? printedScaleOf(words) : null;
        return {
          n: pv.n,
          kind: g.kind,
          name: floor ? g.name : "",
          level: floor ? (g.level ?? 0) : null,
          ref: null,
          preview: previewRefs.get(pv.n) ?? null,
          width: pv.width,
          height: pv.height,
          ...(words.length ? { words } : {}),
          mmPerPx: scale ? mmPerPxFor(scale, { width: pv.width, height: pv.height }) : null,
          scale: scale?.text ?? null,
        };
      });
      await write(orgId, planId, { pages, page_count: previews.length });
      if (Date.now() - started > HANDOFF_MS) return await handOff();
    }

    /* 3. the floors drawn in full, each saved with its place in storage */
    const waiting = pages.filter((p) => p.kind === "floor" && !p.ref);
    if (waiting.length) {
      tell({ step: "floors", done: 0, total: waiting.length });
      const report = (done: number, total: number) => tell({ step: "floors", done, total });
      const file = await bytesOf();
      let full: DrawnFull[] | null = null;
      if (isPdf) {
        const drawnFull = await fullInNode(
          new Uint8Array(file.bytes),
          waiting.map((p) => p.n),
          report,
        ).catch((e) => {
          console.error(`[job-plans] ${planId}/node floors: ${String(e)}`);
          return null;
        });
        if (drawnFull) {
          full = [];
          for (const d of drawnFull) {
            const ref = `org/${orgId}/${newId("plan")}.png`;
            const put = await supabaseAdmin.storage.from(PLANS_BUCKET).upload(ref, d.png, { contentType: "image/png", upsert: false });
            if (put.error) return failed(`A floor couldn't be saved: ${put.error.message}`);
            full.push({ n: d.n, ref, width: d.width, height: d.height, ...(d.trim ? { trim: d.trim } : {}), ...(d.words ? { words: d.words } : {}) });
          }
        }
      }
      if (!full) {
        const slots: NonNullable<PlanPagesTicket["full"]> = [];
        for (const f of waiting) {
          const ref = `org/${orgId}/${newId("plan")}.png`;
          const { data: slot, error } = await supabaseAdmin.storage.from(PLANS_BUCKET).createSignedUploadUrl(ref);
          if (error || !slot) return failed("A page's place in storage couldn't be made.");
          slots.push({ n: f.n, ref, token: slot.token });
        }
        full = (await draw({ orgId, url: signedUrl, kind: plan.sourceKind, full: slots }, origin, file, report)).full ?? [];
      }
      const fullOf = new Map(full.map((f) => [f.n, f]));
      pages = pages.map((p): JobPlanPage => {
        const f = fullOf.get(p.n);
        if (!f) return p;
        const words = (f.words ?? p.words) as PlanWord[] | undefined;
        const scale = printedScaleOf(words);
        return {
          ...p,
          ref: f.ref,
          width: f.width,
          height: f.height,
          ...(f.trim ? { trim: f.trim } : {}),
          ...(words?.length ? { words } : {}),
          mmPerPx: scale ? mmPerPxFor(scale, { width: f.width, height: f.height }) : null,
          scale: scale?.text ?? null,
        };
      });
      await write(orgId, planId, { pages });
      if (pages.some((p) => p.kind === "floor" && !p.ref)) return failed("Not every floor could be drawn in full.");
      if (Date.now() - started > HANDOFF_MS) return await handOff();
    }

    /* 4. the floors read by measure, each kept on its page; then handed on */
    const toMeasure = isPdf && (vectorOn() || measuredOn()) ? pages.filter((p) => p.kind === "floor" && p.ref && p.walled === undefined) : [];
    if (toMeasure.length) {
      if (Date.now() - started > MEASURE_ROOM_MS) return await handOff();
      let done = 0;
      tell({ step: "measuring", done, total: toMeasure.length });
      const bytes = new Uint8Array((await bytesOf()).bytes);
      /* each floor is marked first and written as it lands, one write after
         another: a run that dies here keeps what it had, and what it hadn't
         is read by picture */
      const asked = new Set(toMeasure.map((p) => p.n));
      pages = pages.map((p) => (asked.has(p.n) ? { ...p, walled: { none: NOT_FINISHED } } : p));
      await write(orgId, planId, { pages });
      let turn: Promise<unknown> = Promise.resolve();
      const oneAtATime = <T,>(fn: () => Promise<T>): Promise<T> => {
        const mine = turn.then(fn);
        turn = mine.catch(() => undefined);
        return mine;
      };
      let writing: Promise<unknown> = Promise.resolve();
      await Promise.all(
        toMeasure.map(async (p) => {
          /* a floor that can't be measured is read by picture alone, as before; it never fails the set */
          const w = await measureFloor(bytes, p, started + MEASURE_BY_MS, oneAtATime).catch((e): PageWalled => {
            console.error(`[job-plans] ${planId}/p${p.n} measure: ${String(e)}`);
            return { none: e instanceof Error ? e.message : "It couldn't be measured" };
          });
          pages = pages.map((q) => (q.n === p.n ? { ...q, walled: w } : q));
          const now = pages;
          writing = writing.then(() => write(orgId, planId, { pages: now }));
          await writing;
          tell({ step: "measuring", done: ++done, total: toMeasure.length });
        }),
      );
      /* the read by picture always has a run of its own: on a big set the
         roof read alone takes four minutes, and carried on in the run that
         drew and measured it was cut off at five (3570's re-read, 22
         November 2026: the roof, the site and the schedule were lost and
         the plan stuck on reading) */
      return await handOff();
    }

    /* 5. the read: each floor, the roof and the site off the set */
    const floors = pages.filter((p) => p.kind === "floor" && p.ref).sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.n - b.n);
    const reading: PlanReading = { at: new Date().toISOString(), model: READING_MODEL, floors: {}, failed: [] };
    /* a photo or sketch: read smaller, and its roof left to the Studio, which
       reads it when the 3D wants it (its 243 s on 3465's photo held the read) */
    const photo = plan.sourceKind === "image";
    if (floors.length) {
      const sheets: SheetToRead[] = floors.map((p) => ({
        floorId: pageKey(p.n),
        floorName: p.name || `Page ${p.n}`,
        sheetId: pageKey(p.n),
        ref: p.ref!,
        ...(p.trim ? { crop: p.trim } : {}),
        mmPerPx: p.mmPerPx,
        photo,
      }));
      const pdf = plan.sourceKind === "pdf" ? sourceRef : null;
      const first = Math.max(0, floors[0].n - 1);
      const ground = sheets[0];
      /* each floor, the roof and the site counted off as it comes back */
      const total = sheets.length + (photo ? 0 : 1) + 1;
      let done = 0;
      tell({ step: "reading", done, total });
      const counted = <T,>(p: Promise<T>): Promise<T> =>
        p.finally(() => {
          done++;
          tell({ step: "reading", done, total });
        });
      const [results, measured, roof, site, schedule] = await Promise.all([
        Promise.allSettled(sheets.map((s) => counted(readSheet(orgId, s)))),
        measurePages(orgId, pages, photo),
        photo
          ? undefined
          : counted(readRoof(orgId, pdf, sheets, undefined, first))
              .then(({ said: _said, ...r }) => r)
              .catch((e) => {
                console.error(`[job-plans] ${planId}/roof: ${String(e)}`);
                return null;
              }),
        counted(readSite(orgId, pdf, ground, first)).catch((e) => {
          console.error(`[job-plans] ${planId}/site: ${String(e)}`);
          return null;
        }),
        isPdf
          ? schedulesOf(new Uint8Array((await bytesOf()).bytes), pages).catch((e) => {
              console.error(`[job-plans] ${planId}/schedule: ${String(e)}`);
              return { pages: [] as number[], items: [] as ScheduleItem[] };
            })
          : { pages: [] as number[], items: [] as ScheduleItem[] },
      ]);
      /* a floor not read from the file has its picture-read rooms put on the drawing's own walls, where it has them */
      const bytes = isPdf && vectorOn() ? new Uint8Array((await bytesOf()).bytes) : null;
      const lined = await Promise.all(
        results.map(async (r, i) => {
          const w = floors[i].walled;
          if (!bytes || r.status !== "fulfilled" || (w && "spaces" in w && w.spaces.length)) return null;
          return onTheLines(bytes, floors[i], r.value).catch((e) => {
            console.error(`[job-plans] ${planId}/p${floors[i].n} lines: ${String(e)}`);
            return null;
          });
        }),
      );
      results.forEach((r, i) => {
        const s = sheets[i];
        /* a floor's measured rooms are its rooms; the picture read gives the rest, and is their second reader */
        const walled = floors[i].walled;
        const m = walled && "spaces" in walled && walled.spaces.length ? walled : null;
        if (m) {
          (reading.floors[s.floorId] ??= []).push(withMeasured(r.status === "fulfilled" ? r.value : null, m, s.sheetId));
          /* its rooms stand, but its doors, windows and notes were the picture
             read's to find: said, so the plan asks to be checked and isn't
             shown as Read (the engine's review, 21 November 2026) */
          if (r.status === "rejected") {
            console.error(`[job-plans] ${planId}/${s.sheetId}: ${String(r.reason)}`);
            reading.failed.push({ floorId: s.floorId, sheetId: s.sheetId, reason: `its rooms were measured, but its doors, windows and notes weren't read (${r.reason instanceof Error ? r.reason.message : "it couldn't be read"})` });
          }
        } else if (r.status === "fulfilled") (reading.floors[s.floorId] ??= []).push(lined[i] ?? r.value);
        else {
          console.error(`[job-plans] ${planId}/${s.sheetId}: ${String(r.reason)}`);
          reading.failed.push({ floorId: s.floorId, sheetId: s.sheetId, reason: r.reason instanceof Error ? r.reason.message : "It couldn't be read" });
        }
      });
      /* each opening its schedule's width, height and sill, by its mark */
      if (schedule.items.length) {
        let matched = 0;
        for (const id of Object.keys(reading.floors))
          reading.floors[id] = reading.floors[id].map((sh) => {
            /* a door the read left untagged takes the mark printed beside it, within 900 mm */
            const p = floors.find((f) => pageKey(f.n) === sh.sheetId);
            const reach = 900 / (p?.mmPerPx && p.mmPerPx > 0 ? p.mmPerPx : 35);
            const w = withSchedule(taggedFromWords(sh, (p?.words ?? []) as { text: string; at: { x: number; y: number } }[], schedule.items, reach), schedule.items);
            matched += w.matched;
            return w.sheet;
          });
        reading.schedule = { pages: schedule.pages, marks: schedule.items.length, matched };
      }
      if (roof !== undefined) reading.roof = roof;
      reading.site = site;
      pages = measured;
    }
    const { state, said } = stateOfRead(pages, reading);
    await write(orgId, planId, { pages, reading, state, said, read_at: new Date().toISOString() });
    return { ok: true, state, finished: { jobUuid: plan.jobUuid } };
  } catch (e) {
    console.error(`[job-plans] ${planId}: ${String(e)}`);
    return failed(e instanceof Error ? e.message : "The plan couldn't be read");
  }
}
