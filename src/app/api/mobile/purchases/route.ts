import { ok, requireMobile } from "@/lib/mobile/auth";
import { docketSlot, landDocket, placeLines, priceLine, readDocketPurchase, readPhonePurchase, recentJobs } from "@/lib/mobile/purchases";

/* PURCHASES for the phone (lib/mobile/purchases): one purchase (GET ?id=),
   or Which job?'s Recent (GET); and (POST, by `do`) a slot for the
   docket's photo and its landing, the read that keeps it, Add to job,
   Stock or Undo (`place`), and a price for a line that had none. Behind
   `workboard`, as the web's actions are. */

/* reading a docket takes Tiff tens of seconds */
export const maxDuration = 300;

const no = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const id = new URL(request.url).searchParams.get("id");
  const r = id ? await readPhonePurchase(ctx, id) : await recentJobs(ctx);
  return r.ok ? ok(r.value) : no(r.error, r.status);
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const run =
    body.do === "slot"
      ? docketSlot
      : body.do === "land"
        ? landDocket
        : body.do === "read"
          ? readDocketPurchase
          : body.do === "place"
            ? placeLines
            : body.do === "price"
              ? priceLine
              : null;
  if (!run) return no("What should happen?", 400);
  const r = await run(ctx, body);
  return r.ok ? ok(r.value ?? { ok: true }) : no(r.error, r.status);
}
