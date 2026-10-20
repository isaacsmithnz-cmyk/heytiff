import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isDesignDocumentShape } from "./document";
import type { RoofReading } from "./reading";
import { readRoof, type SheetToRead } from "./reading-server";

/* TIFF REVISES THE 3D (Isaac, 20 October 2026: "She should also be able to
   revise 3d renderings if you are not happy… You should just be able to
   open up the TIFF button. And talk to it"). She reads the set again with
   what she read before and what is wrong with it, and hands back the roof
   and heights corrected, with a line saying what she changed. Nothing is
   saved here: the open design takes it through its own history (Undo). */

export type RoofRevised = { ok: true; roof: RoofReading; said: string } | { ok: false; error: string };

export async function reviseDesignRoof(orgId: string, designId: string, words: string): Promise<RoofRevised> {
  const said = words.trim().slice(0, 2000);
  if (!designId || !said) return { ok: false, error: "Say what's wrong with it." };
  const { data, error } = await supabaseAdmin.from("studio_designs").select("doc").eq("org_id", orgId).eq("id", designId).maybeSingle();
  if (error || !data || !isDesignDocumentShape(data.doc)) return { ok: false, error: "That design isn't saved yet." };
  const doc = data.doc;
  const current = doc.reading?.roof;
  if (!current) return { ok: false, error: "The roof hasn't been read yet: Read the plans in the 3D view first." };
  const firstPlans: SheetToRead[] = doc.floors.flatMap((f) =>
    f.plans.slice(0, 1).map((p) => ({ floorId: f.id, floorName: f.name, sheetId: p.id, ref: p.imageRef, ...(p.crop ? { crop: p.crop } : {}), mmPerPx: f.scaleMmPerUnit })),
  );
  const pdf = doc.planImport?.sources.find((src) => src.kind === "pdf")?.ref ?? null;
  try {
    const { said: line, ...roof } = await readRoof(orgId, pdf, firstPlans, { current, words: said });
    return { ok: true, roof, said: line || "Done." };
  } catch (e) {
    console.error(`[revise-3d] ${designId}: ${String(e)}`);
    return { ok: false, error: "The drawings couldn't be read again this time." };
  }
}
