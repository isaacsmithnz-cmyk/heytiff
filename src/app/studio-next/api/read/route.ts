import type { DesignDocument } from "@/lib/studio/document";
import { firstPlanPage, type PlanReading } from "@/lib/studio/reading";
import { READING_MODEL, readRoof, readSheet, type SheetToRead } from "@/lib/studio/reading-server";
import { LOCAL_ORG, isLocal, notHere } from "../../local";

export const runtime = "nodejs";
export const maxDuration = 300;

/* api/studio/read-plans, with the design handed in from the browser (this
   section keeps designs there). Only what's missing is read, as there. */
export async function POST(request: Request): Promise<Response> {
  if (!isLocal()) return notHere();
  const doc = (await request.json()) as DesignDocument;
  const sheets: SheetToRead[] = doc.floors.flatMap((f) =>
    f.plans.map((p) => ({ floorId: f.id, floorName: f.name, sheetId: p.id, ref: p.imageRef, ...(p.crop ? { crop: p.crop } : {}), mmPerPx: f.scaleMmPerUnit })),
  );
  if (sheets.length === 0) return Response.json({ ok: false, error: "The design has no plans to read." });
  const had = doc.reading ?? null;
  const done = new Set(Object.values(had?.floors ?? {}).flat().map((r) => r.sheetId));
  const toRead = sheets.filter((s) => !done.has(s.sheetId));
  const firstPlans = doc.floors.flatMap((f) => sheets.filter((s) => s.floorId === f.id).slice(0, 1));
  const pdf = doc.planImport?.sources.find((src) => src.kind === "pdf")?.ref ?? null;
  const [results, roof] = await Promise.all([
    Promise.allSettled(toRead.map((s) => readSheet(LOCAL_ORG, s))),
    had?.roof
      ? Promise.resolve(had.roof)
      : readRoof(LOCAL_ORG, pdf, firstPlans, undefined, firstPlanPage(doc.planImport))
          .then(({ said: _said, ...r }) => r)
          .catch(() => null),
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
    else reading.failed.push({ floorId: s.floorId, sheetId: s.sheetId, reason: r.reason instanceof Error ? r.reason.message : "It couldn't be read" });
  });
  return Response.json({ ok: true, reading });
}
