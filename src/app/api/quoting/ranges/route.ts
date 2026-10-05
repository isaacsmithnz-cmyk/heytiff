import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { isRangeKind } from "@/lib/quotes/ranges";
import { rangeCandidates, saveRange } from "@/lib/quotes/ranges-server";

/* The business's ranges that come in sizes (lib/quotes/ranges.ts). GET
   ?kind= — the price book's product lines of that kind, each item with the
   size its name gives, to make a range from. POST {kind, add: [{supplierKey,
   code, size}], remove: [{supplierKey, code}]} — items into the range at
   the sizes a person confirmed, and out of it; answers with the range.
   `financials`, like the rest of the price book. */

async function gate(): Promise<{ orgId: string; userId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "Ranges need money access." }, { status: 403 });
  }
  return { orgId, userId };
}

export async function GET(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const kind = new URL(req.url).searchParams.get("kind");
  if (!isRangeKind(kind)) return Response.json({ ok: false, reason: "No such range." }, { status: 400 });
  return Response.json({ ok: true, lines: await rangeCandidates(who.orgId, kind) });
}

const MAX_ITEMS = 200;

/** An item as the page sent it: its supplier and code, only when both hold up. */
const refOf = (v: unknown): { supplierKey: string; code: string } | null => {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const supplierKey = typeof r.supplierKey === "string" ? r.supplierKey.trim() : "";
  const code = typeof r.code === "string" ? r.code.trim() : "";
  return supplierKey && code && code.length <= 80 && supplierKey.length <= 80 ? { supplierKey, code } : null;
};

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind;
  if (!isRangeKind(kind)) return Response.json({ ok: false, reason: "No such range." }, { status: 400 });
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);
  const add = list(body?.add).flatMap((v) => {
    const ref = refOf(v);
    return ref ? [{ ...ref, size: (v as Record<string, unknown>).size }] : [];
  });
  const remove = list(body?.remove).flatMap((v) => {
    const ref = refOf(v);
    return ref ? [ref] : [];
  });
  if (add.length === 0 && remove.length === 0) return Response.json({ ok: false, reason: "Nothing to change." }, { status: 400 });
  const range = await saveRange(who.orgId, who.userId, kind, add, remove);
  if (!range) return Response.json({ ok: false, reason: "The range couldn't be saved. Try again." });
  return Response.json({ ok: true, range });
}
