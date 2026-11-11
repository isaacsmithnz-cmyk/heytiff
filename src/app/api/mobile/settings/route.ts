import { saveOrgSection } from "@/app/actions/org";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";
import { BUSINESS_FIELDS, readSettings } from "@/lib/mobile/settings";
import { AU_STATES } from "@/lib/org/settings";

/* SETTINGS for the phone (lib/mobile/settings): an admin's public holidays,
   an owner's business, licences and insurance and connections. POST changes
   one of the business's details, through the web's own save (owner only,
   its checks held). */

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
  const body = (await request.json().catch(() => null)) as { field?: unknown; value?: unknown } | null;
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
