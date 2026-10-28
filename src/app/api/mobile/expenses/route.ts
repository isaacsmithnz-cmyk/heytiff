import { ok, requireMobile } from "@/lib/mobile/auth";
import { fileClaim, landReceipt, logFuel, readPhoneExpenses, readPhoneReceipt, receiptSlot, undoClaim } from "@/lib/mobile/expenses";

/* EXPENSE CLAIMS for the phone (lib/mobile/expenses): your own, and what
   you're owed (GET); and (POST, by `do`) a receipt read, a slot for its
   photo and its landing, Send claim or Save the receipt, fuel on the
   vehicle, and Undo. Ungated, as the web's Expense claims page is: only
   ever the caller's own claims. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(await readPhoneExpenses(ctx));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const run =
    body.do === "read"
      ? readPhoneReceipt
      : body.do === "slot"
        ? receiptSlot
        : body.do === "land"
          ? landReceipt
          : body.do === "claim"
            ? fileClaim
            : body.do === "fuel"
              ? logFuel
              : body.do === "undo"
                ? undoClaim
                : null;
  if (!run) return Response.json({ error: "What should happen?" }, { status: 400, headers: { "cache-control": "no-store" } });
  const r = await run(ctx, body);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value ?? { ok: true });
}
