import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { sm8CustomersAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend, sendRefusal } from "@/lib/integrations/sm8-write-plan";
import { CONTACT_ROLES, CUSTOMER_WORDS } from "@/lib/integrations/sm8-customer-plan";
import { readCustomerFormIn, saveCustomerWith } from "@/lib/integrations/sm8-customer-edit";
import { applyPhoneEdit, parsePhoneEdit, sameAddress } from "@/lib/mobile/customer-edit";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* A JOB'S PEOPLE AND ADDRESSES, to change from the phone's Contact sheet
   (Isaac, 17 November 2026, bug 26: "Contact and address should be
   editable, billing address, agent etc, tenant etc."). The web's Edit
   customer, one change at a time, over the same reads, the same diff and
   the same queue door (lib/integrations/sm8-customer-edit).

   GET says whether this person may change them — the deployment saves
   customer changes, they run the board (`workboard_manage`, the web
   dialog's gate) and the owner has Customer details on — and, when they
   may, the job's people with their ids, its site address, and its billing
   address read live from ServiceM8 (null when it couldn't be read). Anyone
   else gets `{ canEdit: false }` and nothing is read.

   POST saves one change ({ pressId, edit }, lib/mobile/customer-edit):
   a person changed or added, a person taken off, the site's address, the
   billing address. The press is minted from the verified token alone. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  if (!sm8CustomersAllowed() || !ctx.caps.has("workboard_manage")) return ok({ canEdit: false });
  const state = await readSm8WriteState(ctx.orgId);
  if (!offersSend(state, "customer")) return ok({ canEdit: false });

  const id = (await params).id.trim().slice(0, 80);
  if (!id) return no(400, "Which job?");
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  const r = await readCustomerFormIn(ctx.orgId, parentRemoteId);
  if (!r.ok) return no(404, r.error);
  const site = r.form.siteAddress ?? "";
  return ok({
    canEdit: true,
    people: r.form.contacts.map((c) => ({ id: c.uuid, first: c.first, last: c.last, mobile: c.mobile, phone: c.phone, email: c.email, type: c.type })),
    site,
    billing: r.form.billingAddress,
    billingSame: r.form.billingAddress !== null && sameAddress(r.form.billingAddress, site),
    roles: CONTACT_ROLES.map((x) => ({ type: x.type, word: x.word })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  if (!sm8CustomersAllowed()) return no(409, CUSTOMER_WORDS.card.customersUnavailable);
  if (!ctx.caps.has("workboard_manage")) return no(403, CUSTOMER_WORDS.press.noManage);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return no(400, CUSTOMER_WORDS.press.unqueued);
  }
  const pressId = (body as { pressId?: unknown } | null)?.pressId;
  const edit = parsePhoneEdit(body);
  if (typeof pressId !== "string" || !UUID.test(pressId) || !edit) return no(400, CUSTOMER_WORDS.press.unqueued);

  const press = await sm8PressFromMobile(ctx);
  if (!press) return no(401, "Sign in again.");
  const state = await readSm8WriteState(ctx.orgId);
  if (!state.readable) return no(503, CUSTOMER_WORDS.press.unreadable);
  if (!offersSend(state, "customer")) return no(409, sendRefusal(state, "customer") ?? CUSTOMER_WORDS.press.kindOff);

  const id = (await params).id.trim().slice(0, 80);
  if (!id) return no(400, "Which job?");
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  const a = await saveCustomerWith(press, pressId, { jobUuid: parentRemoteId, shape: (before) => applyPhoneEdit(before, edit) }, startedAt);
  if (!a.ok) {
    /* saving what's already there is done, not a refusal */
    if (a.error === CUSTOMER_WORDS.press.nothing) return ok({ saved: 0, waiting: 0 });
    return no(400, a.error);
  }
  if (a.failed.length > 0) return no(400, a.failed[0]!);
  return ok({ saved: a.saved, waiting: a.waiting });
}
