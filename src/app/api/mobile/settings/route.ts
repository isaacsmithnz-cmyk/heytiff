import { saveOrgSection } from "@/app/actions/org";
import { retryFailedServiceM8WritesAction, syncServiceM8NowAction } from "@/app/actions/integrations";
import { actAsPhoneUser, ok, requireMobile, type MobileCtx } from "@/lib/mobile/auth";
import { BUSINESS_FIELDS, readSettings } from "@/lib/mobile/settings";
import { AU_STATES } from "@/lib/org/settings";
import { savePaySettings } from "@/app/actions/timepay";
import { getPaySettings } from "@/lib/timepay/query";
import { paidTimeOf, parseClock, type PaidTime } from "@/components/timepay/logic";

/* SETTINGS for the phone (lib/mobile/settings): an admin's public holidays,
   an owner's business, licences and insurance and connections. POST changes
   one of the business's details, through the web's own save (owner only,
   its checks held); or, an owner's, reads ServiceM8 now ({do: "read"}) or
   sends again what didn't go ({do: "retry"}), the ServiceM8 page's own
   buttons. */

/* a read of ServiceM8 runs in the foreground, as its button's does */
export const maxDuration = 300;

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const s = await readSettings(ctx);
  if (!s) return no(403, "Settings are for an owner or an admin.");
  return ok(s);
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { field?: unknown; value?: unknown; do?: unknown; paid?: unknown } | null;
  /* Paid time: the normal start or finish, or one rule, through Time & Pay's own save (financials, its check held) */
  if (body?.paid && typeof body.paid === "object") {
    const r = await savePaid(ctx, body.paid as { key?: unknown; value?: unknown });
    if (!r.ok) return no(r.status, r.error);
    const s = await readSettings(ctx);
    return s ? ok(s) : no(403, "Settings are for an owner or an admin.");
  }
  if (body?.do === "read" || body?.do === "retry") {
    const r = await actAsPhoneUser(ctx, () => (body.do === "read" ? syncServiceM8NowAction() : retryFailedServiceM8WritesAction()));
    if (!r.ok) return no(409, r.error);
    const s = await readSettings(ctx);
    return s ? ok({ ...s, note: r.note ?? null }) : no(403, "Settings are for an owner or an admin.");
  }
  const f = BUSINESS_FIELDS.find((x) => x.field === body?.field);
  if (!f || typeof body?.value !== "string") return no(400, "Which detail?");
  const value = (body.value as string).trim().slice(0, 300);
  /* the state is one of the eight, in capitals: "nsw" is NSW, anything else is said, never dropped quietly (found in review) */
  if (f.field === "state" && value && !AU_STATES.includes(value.toUpperCase() as (typeof AU_STATES)[number])) return no(400, "A state is NSW, VIC, QLD, WA, SA, TAS, ACT or NT.");
  const r = await actAsPhoneUser(ctx, () => saveOrgSection(f.section, { [f.field]: f.field === "state" ? value.toUpperCase() : value }));
  if (!r.ok) return no(409, r.error);
  const s = await readSettings(ctx);
  return s ? ok(s) : no(403, "Settings are for an owner or an admin.");
}

const RULES: readonly (keyof PaidTime)[] = ["officeClocksOn", "officeBeforeStartPaid", "driveFromLeaving"];

/** "7:00 AM" from a clock time, as Time & Pay keeps it. */
const clockWords = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m < 720 ? "AM" : "PM"}`;

async function savePaid(ctx: MobileCtx, p: { key?: unknown; value?: unknown }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { settings } = await getPaySettings(ctx.orgId);
  const rules = paidTimeOf(settings.paidTime);
  let next = { ...settings, paidTime: rules };
  if (p.key === "start" || p.key === "end") {
    const m = typeof p.value === "string" ? parseClock(p.value) : null;
    if (m === null || m % 15 !== 0) return { ok: false, status: 400, error: "Pick a time on the quarter hour." };
    const start = p.key === "start" ? m : parseClock(settings.defaultStart);
    const end = p.key === "end" ? m : parseClock(settings.defaultEnd);
    if (start !== null && end !== null && end <= start) return { ok: false, status: 400, error: "The finish has to be after the start." };
    next = p.key === "start" ? { ...next, defaultStart: clockWords(m) } : { ...next, defaultEnd: clockWords(m) };
  } else if (RULES.includes(p.key as keyof PaidTime) && typeof p.value === "boolean") {
    next = { ...next, paidTime: { ...rules, [p.key as keyof PaidTime]: p.value } };
  } else return { ok: false, status: 400, error: "Which rule?" };
  const r = await actAsPhoneUser(ctx, () => savePaySettings(next));
  return r.ok ? { ok: true } : { ok: false, status: 403, error: r.error };
}
