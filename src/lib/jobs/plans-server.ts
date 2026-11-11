import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { newId } from "@/lib/studio/document";
import { launchHeadless, printBase } from "@/lib/studio/pdf-render";
import { signPlanPagesTicket, type PlanPagesTicket } from "@/lib/studio/pdf-request";
import { mmPerPxFor, printedScaleOf } from "@/lib/studio/plan-set";
import { scaleFromDimensions, type PlanReading, type PlanWord } from "@/lib/studio/reading";
import { READING_MODEL, readDimensions, readRoof, readSheet, readSite, type SheetToRead } from "@/lib/studio/reading-server";
import { SONNET_FALLBACK } from "@/lib/tiff/sonnet-fallback";
import { openPdf } from "@/lib/tiff/extract";
import { airPages, plainWords } from "./take-in";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import type { DrawnFull, DrawnPreview, PlanPagesAnswer } from "@/app/print/plan-pages/plan-pages";
import { guessPageByWords, pageKey, stackLevels, stateOfRead, type JobPlan, type JobPlanKind, type SpecWords, type JobPlanPage, type JobPlanRead, type PageGuess, type PlanPageKind, type PlanPick } from "./plans";
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
};
const COLS = "id, org_id, job_uuid, document_id, attachment_id, name, source_ref, source_kind, kind, page_count, pages, reading, state, said, added_by, added_at, read_at";

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

export type FileAt = { name: string; ref: string; mime: string | null };

/** Where the picked file's bytes are, in the documents bucket: one of ours
    on this job, or ServiceM8's cached copy. Null when the file isn't this
    job's or its bytes aren't here yet. */
export async function fileFor(orgId: string, jobUuid: string, pick: PlanPick): Promise<FileAt | null> {
  if ("documentId" in pick) {
    const { data } = await supabaseAdmin
      .from("documents")
      .select("file_name, storage_ref, mime_type, sm8_job_uuid, uploaded_at")
      .eq("org_id", orgId)
      .eq("id", pick.documentId)
      .maybeSingle();
    const d = data as { file_name: string | null; storage_ref: string; mime_type: string | null; sm8_job_uuid: string | null; uploaded_at: string | null } | null;
    if (!d || d.sm8_job_uuid !== jobUuid || !d.uploaded_at) return null;
    return { name: d.file_name ?? "Plan", ref: d.storage_ref, mime: d.mime_type };
  }
  const [{ data: att }, { data: cached }] = await Promise.all([
    supabaseAdmin.from("sm8_attachments").select("attachment_name, file_type").eq("org_id", orgId).eq("uuid", pick.attachmentId).maybeSingle(),
    supabaseAdmin.from("documents").select("storage_ref, mime_type").eq("org_id", orgId).eq("source", "servicem8").eq("remote_ref", pick.attachmentId).not("uploaded_at", "is", null).maybeSingle(),
  ]);
  const a = att as { attachment_name: string | null; file_type: string | null } | null;
  const c = cached as { storage_ref: string; mime_type: string | null } | null;
  if (!a || !c) return null;
  return { name: a.attachment_name ?? "Plan", ref: c.storage_ref, mime: c.mime_type ?? (a.file_type === ".pdf" ? "application/pdf" : null) };
}

export const kindOf = (f: FileAt): "pdf" | "image" | null => {
  const m = (f.mime ?? "").toLowerCase();
  if (m === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
  if (/^image\/(png|jpe?g|webp)$/.test(m) || /\.(png|jpe?g|webp)$/i.test(f.name)) return "image";
  return null;
};

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
    if (have.data) {
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

/** One visit of the headless browser to /print/plan-pages. */
async function draw(ticket: PlanPagesTicket, origin: string): Promise<PlanPagesAnswer> {
  const browser = await launchHeadless();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(DRAW_MS);
    const url = new URL("/print/plan-pages", printBase(origin));
    url.searchParams.set("t", signPlanPagesTicket(ticket));
    const res = await page.goto(url.toString(), { waitUntil: "load", timeout: 60_000 });
    if (!res || !res.ok()) throw new Error(`the plan page answered ${res?.status() ?? "nothing"}`);
    await page.waitForFunction("window.__htPdfReady === true", { timeout: DRAW_MS });
    const out = (await page.evaluate("({ pages: window.__htPlanPages ?? null, error: window.__htPlanPagesError ?? null })")) as { pages: PlanPagesAnswer | null; error: string | null };
    if (out.error) throw new Error(out.error);
    if (!out.pages) throw new Error("the pages didn't come back");
    return out.pages;
  } finally {
    await browser.close();
  }
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
  const floors = [...out.values()].filter((g) => g.kind === "floor").length;
  if (floors === 0 && decided < previews.length) {
    /* the words named no floor: let her look */
    const looked = await guessPagesByLook(previews, client).catch((e) => {
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
async function measurePages(orgId: string, pages: readonly JobPlanPage[]): Promise<JobPlanPage[]> {
  return Promise.all(
    pages.map(async (p): Promise<JobPlanPage> => {
      if (p.kind !== "floor" || !p.ref || p.mmPerPx || p.measured !== undefined) return p;
      try {
        const dims = await readDimensions(orgId, { floorId: pageKey(p.n), floorName: p.name || `Page ${p.n}`, sheetId: pageKey(p.n), ref: p.ref, ...(p.trim ? { crop: p.trim } : {}), mmPerPx: null });
        return { ...p, measured: scaleFromDimensions(dims, p) };
      } catch (e) {
        console.error(`[job-plans] page ${p.n} dimensions: ${String(e)}`);
        return p;
      }
    }),
  );
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
      if (!p.pages.some((pg) => pg.kind === "floor" && pg.ref && !pg.mmPerPx && pg.measured === undefined)) return;
      const pages = await measurePages(orgId, p.pages);
      if (pages.some((pg, i) => pg !== p.pages[i])) await write(orgId, p.id, { pages }).catch(() => {});
    }),
  );
  if (toRead.length || plans.some((p) => p.pages.some((pg) => pg.kind === "floor" && pg.ref && !pg.mmPerPx && pg.measured === undefined))) {
    const again = await supabaseAdmin.from("job_plans").select(COLS).eq("org_id", orgId).eq("job_uuid", jobUuid).order("added_at", { ascending: true });
    if (!again.error) plans = ((again.data ?? []) as Row[]).map((r) => planOf(r, new Map()));
  }
  const rooms = plans.map(planRoomsOf);
  return { plans: rooms, said: planRoomsSaid(rooms) };
}

/* ── the read ── */

export type ReadPlanOutcome = { ok: true; state: JobPlan["state"] } | { ok: false; error: string };

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
  try {
    const file = await fileFor(orgId, plan.jobUuid, pick);
    if (!file) return failed("The file isn't on the job any more.");
    if (plan.kind === "spec") return await readSpec(orgId, planId, file);
    /* 1. the set's own copy */
    const sourceRef = plan.sourceRef ?? (await copySource(orgId, file, plan.sourceKind));
    if (!plan.sourceRef) await write(orgId, planId, { source_ref: sourceRef });
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from(PLANS_BUCKET).createSignedUrl(sourceRef, SIGNED_SECONDS);
    if (signErr || !signed) return failed("The file couldn't be opened for drawing.");

    /* 2 to 4: the pages, which are the floors, and the floors in full */
    let pages = plan.pages;
    if (!pages.some((p) => p.kind === "floor" && p.ref)) {
      const drawn = await draw({ orgId, url: signed.signedUrl, kind: plan.sourceKind }, origin);
      const previews = drawn.previews ?? [];
      if (previews.length === 0) return failed("No pages could be drawn from the file.");
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
      /* their full rasters, straight into the bucket */
      let full: DrawnFull[] = [];
      if (floors.length) {
        const slots: NonNullable<PlanPagesTicket["full"]> = [];
        for (const f of floors) {
          const ref = `org/${orgId}/${newId("plan")}.png`;
          const { data: slot, error } = await supabaseAdmin.storage.from(PLANS_BUCKET).createSignedUploadUrl(ref);
          if (error || !slot) return failed("A page's place in storage couldn't be made.");
          slots.push({ n: f.n, ref, token: slot.token });
        }
        full = (await draw({ orgId, url: signed.signedUrl, kind: plan.sourceKind, full: slots }, origin)).full ?? [];
      }
      const fullOf = new Map(full.map((f) => [f.n, f]));
      pages = previews.map((pv): JobPlanPage => {
        const g = floors.find((f) => f.n === pv.n) ?? guesses.get(pv.n) ?? { kind: "other" as const, name: "", level: null };
        const f = fullOf.get(pv.n);
        const words: PlanWord[] | undefined = (f?.words ?? pv.words) as PlanWord[] | undefined;
        const scale = f ? printedScaleOf(words) : null;
        const mm = scale && f ? mmPerPxFor(scale, { width: f.width, height: f.height }) : null;
        return {
          n: pv.n,
          kind: g.kind,
          name: g.kind === "floor" ? g.name : "",
          level: g.kind === "floor" ? (g.level ?? 0) : null,
          ref: f?.ref ?? null,
          preview: previewRefs.get(pv.n) ?? null,
          width: f?.width ?? pv.width,
          height: f?.height ?? pv.height,
          ...(f?.trim ? { trim: f.trim } : {}),
          ...(f && words?.length ? { words } : {}),
          mmPerPx: mm,
          scale: scale?.text ?? null,
        };
      });
      await write(orgId, planId, { pages, page_count: previews.length });
    }

    /* 5. the read: each floor, the roof and the site off the set */
    const floors = pages.filter((p) => p.kind === "floor" && p.ref).sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.n - b.n);
    const reading: PlanReading = { at: new Date().toISOString(), model: READING_MODEL, floors: {}, failed: [] };
    if (floors.length) {
      const sheets: SheetToRead[] = floors.map((p) => ({
        floorId: pageKey(p.n),
        floorName: p.name || `Page ${p.n}`,
        sheetId: pageKey(p.n),
        ref: p.ref!,
        ...(p.trim ? { crop: p.trim } : {}),
        mmPerPx: p.mmPerPx,
      }));
      const pdf = plan.sourceKind === "pdf" ? sourceRef : null;
      const first = Math.max(0, floors[0].n - 1);
      const ground = sheets[0];
      const [results, measured, roof, site] = await Promise.all([
        Promise.allSettled(sheets.map((s) => readSheet(orgId, s))),
        measurePages(orgId, pages),
        readRoof(orgId, pdf, sheets, undefined, first)
          .then(({ said: _said, ...r }) => r)
          .catch((e) => {
            console.error(`[job-plans] ${planId}/roof: ${String(e)}`);
            return null;
          }),
        readSite(orgId, pdf, ground, first).catch((e) => {
          console.error(`[job-plans] ${planId}/site: ${String(e)}`);
          return null;
        }),
      ]);
      results.forEach((r, i) => {
        const s = sheets[i];
        if (r.status === "fulfilled") (reading.floors[s.floorId] ??= []).push(r.value);
        else {
          console.error(`[job-plans] ${planId}/${s.sheetId}: ${String(r.reason)}`);
          reading.failed.push({ floorId: s.floorId, sheetId: s.sheetId, reason: r.reason instanceof Error ? r.reason.message : "It couldn't be read" });
        }
      });
      reading.roof = roof;
      reading.site = site;
      pages = measured;
    }
    const { state, said } = stateOfRead(pages, reading);
    await write(orgId, planId, { pages, reading, state, said, read_at: new Date().toISOString() });
    return { ok: true, state };
  } catch (e) {
    console.error(`[job-plans] ${planId}: ${String(e)}`);
    return failed(e instanceof Error ? e.message : "The plan couldn't be read");
  }
}
