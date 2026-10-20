import { requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isDesignDocumentShape } from "@/lib/studio/document";
import type { PlanReading } from "@/lib/studio/reading";
import { READING_MODEL, readRoof, readSheet, type SheetToRead } from "@/lib/studio/reading-server";

/* POST { designId } — Tiff reads every plan on the design's floors (v2,
   20 October) and hands the reading back for the Studio to keep on the
   design. The plans are the stored design's own, read on the server: the
   browser names the design, never the files.

   Each sheet is two Opus reads side by side (the checklist and the
   furniture), about a minute and a half; the sheets run together, so a
   house reads in about the time of its slowest sheet. A sheet that fails
   is said in `failed`, and the rest still come back.

   The roof and the heights are a read of their own beside them (Isaac, 20
   October 2026: "Roof and framing should always be done"): the uploaded
   set itself, elevations and sections and all, with each floor's plan to
   set the roof out on.

   ONLY WHAT IS MISSING IS READ. A design read before keeps its sheets and
   its roof; asking again reads a sheet it hasn't read (a floor added since)
   and the roof if it has none, so pressing it twice never pays twice. */

export const runtime = "nodejs";
export const maxDuration = 300;

type Answer = { ok: true; reading: PlanReading } | { ok: false; error: string };
const answer = (r: Answer, status = 200) => Response.json(r, { status });

export async function POST(request: Request): Promise<Response> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("studio"));
  } catch {
    return answer({ ok: false, error: "Sign in to read the plans." }, 401);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const designId = typeof body?.designId === "string" ? body.designId.slice(0, 80) : "";
  if (!designId) return answer({ ok: false, error: "Which design?" }, 400);

  const { data, error } = await supabaseAdmin.from("studio_designs").select("doc").eq("org_id", orgId).eq("id", designId).maybeSingle();
  if (error || !data || !isDesignDocumentShape(data.doc)) return answer({ ok: false, error: "That design isn't saved yet." }, 404);

  const sheets: SheetToRead[] = data.doc.floors.flatMap((f) =>
    f.plans.map((p) => ({
      floorId: f.id,
      floorName: f.name,
      sheetId: p.id,
      ref: p.imageRef,
      ...(p.crop ? { crop: p.crop } : {}),
      mmPerPx: f.scaleMmPerUnit,
    })),
  );
  if (sheets.length === 0) return answer({ ok: false, error: "The design has no plans to read." });

  const had = data.doc.reading ?? null;
  const done = new Set(Object.values(had?.floors ?? {}).flat().map((r) => r.sheetId));
  const toRead = sheets.filter((s) => !done.has(s.sheetId));
  /* the roof is set out on each floor's first plan; the set is the first PDF uploaded */
  const firstPlans = data.doc.floors.flatMap((f) => sheets.filter((s) => s.floorId === f.id).slice(0, 1));
  const pdf = data.doc.planImport?.sources.find((src) => src.kind === "pdf")?.ref ?? null;

  const [results, roof] = await Promise.all([
    Promise.allSettled(toRead.map((s) => readSheet(orgId, s))),
    had?.roof
      ? Promise.resolve(had.roof)
      : readRoof(orgId, pdf, firstPlans).catch((e) => {
          console.error(`[read-plans] ${designId}/roof: ${String(e)}`);
          return null;
        }),
  ]);
  const reading: PlanReading = {
    at: new Date().toISOString(),
    model: READING_MODEL,
    floors: Object.fromEntries(Object.entries(had?.floors ?? {}).map(([k, v]) => [k, [...v]])),
    failed: [],
    roof,
  };
  results.forEach((r, i) => {
    const s = toRead[i];
    if (r.status === "fulfilled") (reading.floors[s.floorId] ??= []).push(r.value);
    else {
      console.error(`[read-plans] ${designId}/${s.sheetId}: ${String(r.reason)}`);
      reading.failed.push({ floorId: s.floorId, sheetId: s.sheetId, reason: r.reason instanceof Error ? r.reason.message : "It couldn't be read" });
    }
  });
  return answer({ ok: true, reading });
}
