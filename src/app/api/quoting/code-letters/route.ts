import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { openPdf } from "@/lib/tiff/extract";
import { isLettersMedia, keepLetterRules, readCodeLetters, readLetterRules, removeLetterRule } from "@/lib/quotes/code-letters-server";
import { MAX_INVOICE_BYTES } from "@/lib/quotes/invoice-read";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import type { LetterRule } from "@/lib/quotes/code-letters";

/* A maker's code letters (lib/quotes/code-letters.ts). GET ?supplier= — the
   rules kept for a supplier. POST multipart {supplier, file} — a brochure
   or trade price book, a PDF or a photo, read by Tiff for the letters it
   explains; nothing is saved. PATCH {supplier, source, rules} — the rules a
   person ticked, kept. DELETE ?id= — one taken back. `financials`, like
   the rest of the price book. */

/* reading a brochure takes Tiff tens of seconds */
export const maxDuration = 300;

/* a legend is near the front: a ceiling on what one read can spend */
const MAX_PAGES = 40;

async function gate(): Promise<{ orgId: string; userId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  return { orgId, userId };
}

const supplierIn = async (orgId: string, key: unknown) => (await readSuppliers(orgId)).find((s) => s.key === key) ?? null;

export async function GET(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const supplier = new URL(req.url).searchParams.get("supplier") ?? "";
  return Response.json({ ok: true, rules: await readLetterRules(who.orgId, supplier || undefined) });
}

/** How many pages a PDF has, or null when it can't be opened. */
async function pagesOf(bytes: Buffer): Promise<number | null> {
  const pdf = await openPdf(new Uint8Array(bytes)).catch(() => null);
  if (!pdf) return null;
  const pages = pdf.numPages;
  await pdf.destroy();
  return pages;
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ ok: false, reason: "Tiff isn't set up on this deployment." });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, reason: "Choose a file first." }, { status: 400 });
  if (!isLettersMedia(file.type)) return Response.json({ ok: false, reason: "Tiff reads a PDF, or a photo as JPEG, PNG or WebP." }, { status: 400 });
  if (file.size > MAX_INVOICE_BYTES) return Response.json({ ok: false, reason: "That file is over 4 MB." }, { status: 400 });
  if (!(await supplierIn(who.orgId, form?.get("supplier")))) return Response.json({ ok: false, reason: "No such supplier." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (file.type === "application/pdf") {
    const pages = await pagesOf(bytes);
    if (pages === null) return Response.json({ ok: false, reason: "That PDF couldn't be opened." });
    if (pages > MAX_PAGES) return Response.json({ ok: false, reason: `That's ${pages} pages. Tiff reads up to ${MAX_PAGES}: the pages that explain the codes.` });
  }
  return Response.json(await readCodeLetters(bytes, file.type));
}

/** A rule as the page sent it, only when its parts are strings. */
function ruleOf(v: unknown): LetterRule | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const ex = (r.example && typeof r.example === "object" ? r.example : {}) as Record<string, unknown>;
  const s = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const rule = { family: s(r.family, 24), letter: s(r.letter, 3), meaning: s(r.meaning, 60), example: { with: s(ex.with, 40), without: s(ex.without, 40) } };
  return rule.family && rule.letter && rule.meaning.length >= 2 && rule.example.with ? rule : null;
}

export async function PATCH(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const supplier = await supplierIn(who.orgId, body?.supplier);
  if (!supplier) return Response.json({ ok: false, reason: "No such supplier." }, { status: 400 });
  const rules = (Array.isArray(body?.rules) ? body.rules.slice(0, 60) : []).map(ruleOf).filter((r): r is LetterRule => r !== null);
  if (rules.length === 0) return Response.json({ ok: false, reason: "No rules to keep." }, { status: 400 });
  const source = typeof body?.source === "string" ? body.source : "";
  const ok = await keepLetterRules(who.orgId, who.userId, supplier.key, source, rules);
  if (!ok) return Response.json({ ok: false, reason: "Those rules couldn't be kept. Try again." });
  return Response.json({ ok: true, rules: await readLetterRules(who.orgId, supplier.key) });
}

export async function DELETE(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ ok: false, reason: "No such rule." }, { status: 400 });
  return Response.json(await removeLetterRule(who.orgId, id) ? { ok: true } : { ok: false, reason: "That rule couldn't be taken out. Try again." });
}
