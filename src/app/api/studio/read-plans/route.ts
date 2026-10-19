import { requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isDesignDocumentShape } from "@/lib/studio/document";
import type { PlanReading } from "@/lib/studio/reading";
import { READING_MODEL, readSheet, type SheetToRead } from "@/lib/studio/reading-server";

/* POST { designId } — Tiff reads every plan on the design's floors (v2,
   20 October) and hands the reading back for the Studio to keep on the
   design. The plans are the stored design's own, read on the server: the
   browser names the design, never the files.

   Each sheet is two Opus reads side by side (the checklist and the
   furniture), about a minute and a half; the sheets run together, so a
   house reads in about the time of its slowest sheet. A sheet that fails
   is said in `failed`, and the rest still come back. */

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

  const results = await Promise.allSettled(sheets.map((s) => readSheet(orgId, s)));
  const reading: PlanReading = { at: new Date().toISOString(), model: READING_MODEL, floors: {}, failed: [] };
  results.forEach((r, i) => {
    const s = sheets[i];
    if (r.status === "fulfilled") (reading.floors[s.floorId] ??= []).push(r.value);
    else {
      console.error(`[read-plans] ${designId}/${s.sheetId}: ${String(r.reason)}`);
      reading.failed.push({ floorId: s.floorId, sheetId: s.sheetId, reason: r.reason instanceof Error ? r.reason.message : "It couldn't be read" });
    }
  });
  return answer({ ok: true, reading });
}
