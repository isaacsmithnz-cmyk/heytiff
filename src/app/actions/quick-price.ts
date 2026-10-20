"use server";

import type { QuickOffer } from "@/lib/quotes/quick-price-server";

/* A quick price from Tiff's answer onto the job's quote, as an option of its
   own (lib/quotes/quick-price-server `addQuickToQuote`). The parts and hours
   come from the page; their prices never do: each is priced again from the
   business's book and rate. */

export type AddQuickResult = { ok: true; option: number } | { ok: false; error: string };

function offerOf(raw: unknown): QuickOffer | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const jobUuid = typeof r.jobUuid === "string" && /^[\w-]{8,64}$/.test(r.jobUuid) ? r.jobUuid : null;
  const parts = (Array.isArray(r.parts) ? r.parts : []).slice(0, 30).flatMap((p) => {
    const x = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const qty = typeof x.qty === "number" && Number.isFinite(x.qty) ? Math.min(999, Math.max(0, x.qty)) : 0;
    return typeof x.code === "string" && x.code && typeof x.name === "string" && qty > 0
      ? [{ name: x.name.slice(0, 200), code: x.code.slice(0, 80), qty, kind: x.kind === "unit" ? ("unit" as const) : ("material" as const) }]
      : [];
  });
  const hours = typeof r.hours === "number" && Number.isFinite(r.hours) ? Math.min(200, Math.max(0, r.hours)) : 0;
  const title = typeof r.title === "string" ? r.title.trim().slice(0, 80) : "";
  return parts.length > 0 || hours > 0 ? { jobUuid, title: title || "Quick price", parts, hours } : null;
}

export async function addQuickPriceToQuote(raw: unknown): Promise<AddQuickResult> {
  let g: { orgId: string; userId: string };
  try {
    const { requireOrg } = await import("@/lib/permissions-server");
    g = await requireOrg("workboard");
  } catch {
    return { ok: false, error: "Sign in again to add it to the quote." };
  }
  const offer = offerOf(raw);
  if (!offer) return { ok: false, error: "There's nothing in that price to add." };
  /* loaded when it's pressed, as the permission check above is: the chat
     that imports this action needn't carry the server behind it */
  const { addQuickToQuote } = await import("@/lib/quotes/quick-price-server");
  const r = await addQuickToQuote(g.orgId, offer, g.userId);
  return r.ok ? r : { ok: false, error: r.reason };
}
