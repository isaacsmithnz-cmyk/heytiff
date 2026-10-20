import { requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isDesignDocumentShape } from "@/lib/studio/document";
import type { RoofReading } from "@/lib/studio/reading";
import { readRoof, type SheetToRead } from "@/lib/studio/reading-server";

/* POST { designId, words } — Tiff revises the design's 3D (Isaac, 20
   October 2026: "She should also be able to revise 3d renderings if you are
   not happy, similar to how we have done it in chat"). She reads the set
   again with what she read before and what is wrong with it, and hands
   back the roof and heights corrected, with a line saying what she
   changed. Nothing is saved here: the Studio keeps it on the design through
   its own history, so Undo takes it back. */

export const runtime = "nodejs";
export const maxDuration = 300;

type Answer = { ok: true; roof: RoofReading; said: string } | { ok: false; error: string };
const answer = (r: Answer, status = 200) => Response.json(r, { status });

export async function POST(request: Request): Promise<Response> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("studio"));
  } catch {
    return answer({ ok: false, error: "Sign in to change the design." }, 401);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const designId = typeof body?.designId === "string" ? body.designId.slice(0, 80) : "";
  const words = typeof body?.words === "string" ? body.words.trim().slice(0, 2000) : "";
  if (!designId || !words) return answer({ ok: false, error: "Say what's wrong with it." }, 400);

  const { data, error } = await supabaseAdmin.from("studio_designs").select("doc").eq("org_id", orgId).eq("id", designId).maybeSingle();
  if (error || !data || !isDesignDocumentShape(data.doc)) return answer({ ok: false, error: "That design isn't saved yet." }, 404);
  const doc = data.doc;
  const current = doc.reading?.roof;
  if (!current) return answer({ ok: false, error: "Tiff hasn't read the roof yet: Read the plans first." });

  const firstPlans: SheetToRead[] = doc.floors.flatMap((f) =>
    f.plans.slice(0, 1).map((p) => ({ floorId: f.id, floorName: f.name, sheetId: p.id, ref: p.imageRef, ...(p.crop ? { crop: p.crop } : {}), mmPerPx: f.scaleMmPerUnit })),
  );
  const pdf = doc.planImport?.sources.find((src) => src.kind === "pdf")?.ref ?? null;
  try {
    const { said, ...roof } = await readRoof(orgId, pdf, firstPlans, { current, words });
    return answer({ ok: true, roof, said: said || "Done." });
  } catch (e) {
    console.error(`[revise-3d] ${designId}: ${String(e)}`);
    return answer({ ok: false, error: "Tiff couldn't change it this time. Try again, or say it another way." });
  }
}
