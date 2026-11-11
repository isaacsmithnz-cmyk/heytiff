import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { listOrgCredentials } from "@/lib/org/query";
import { getConnectionView } from "@/lib/integrations/store";
import { holidaysInSpan } from "@/lib/timepay/leave-query";
import { todayOf } from "./used";
import { actAsPhoneUser, type MobileCtx } from "./auth";

/* SETTINGS ON THE PHONE (Isaac, 10 November 2026: "do some work on the
   settings section of tiff mobile ... Get the app almost full featured to
   limit web use"; https://claude.ai/artifact/26EjQygddnyfT9YYLP7EWo, built 12
   November: "Don't wait for my answers. Just build"). What the web's
   Organisation screen holds that's worth a phone: for an owner, the
   business's details (each changed one at a time, through the web's own
   saveOrgSection, so its checks hold: the ABN's checksum, the state), its
   licences and insurance with when each runs out, and whether ServiceM8 and
   Xero are connected; for an admin, the public holidays alone, as on the
   web. Logo, colour, price book, rates, pay and connecting stay on the web. */

export const BUSINESS_FIELDS = [
  { section: "identity", field: "trading_name", label: "Trading name" },
  { section: "identity", field: "legal_name", label: "Legal name" },
  { section: "identity", field: "abn", label: "ABN" },
  { section: "contact", field: "phone", label: "Phone" },
  { section: "contact", field: "email", label: "Email" },
  { section: "contact", field: "website", label: "Website" },
  { section: "contact", field: "address", label: "Address" },
  { section: "contact", field: "suburb", label: "Suburb" },
  { section: "contact", field: "state", label: "State" },
  { section: "contact", field: "postcode", label: "Postcode" },
] as const;

export type Settings = {
  owner: boolean;
  business: { section: string; field: string; label: string; value: string | null }[] | null;
  credentials: { name: string; kind: string; number: string | null; issuer: string | null; expires: string | null; days: number | null }[] | null;
  connections: { name: string; connected: boolean; account: string | null; since: string | null; error: string | null }[] | null;
  /** what didn't go to ServiceM8 in the last fortnight, for Try it again (the owner's) */
  failed: number;
  holidays: { date: string; name: string }[];
};

const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export async function readSettings(ctx: MobileCtx): Promise<Settings | null> {
  const role = await actAsPhoneUser(ctx, () => getDbRole());
  if (!hasMinRole(role, "admin")) return null;
  const owner = hasMinRole(role, "owner");
  const today = await todayOf(ctx.orgId);
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("trading_name, legal_name, abn, phone, email, website, address, suburb, state, postcode")
    .eq("id", ctx.orgId)
    .maybeSingle();
  const o = (org ?? {}) as Record<string, string | null>;
  const yearOn = new Date(Date.parse(`${today}T00:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10);
  const holidays = await holidaysInSpan(ctx.orgId, o.state ?? null, today, yearOn).catch(() => []);
  if (!owner) return { owner, business: null, credentials: null, connections: null, holidays, failed: 0 };

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [creds, sm8, xero, { count }] = await Promise.all([
    listOrgCredentials(ctx.orgId).catch(() => []),
    getConnectionView(ctx.orgId, "servicem8").catch(() => null),
    getConnectionView(ctx.orgId, "xero").catch(() => null),
    supabaseAdmin.from("sm8_writes").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("status", "failed").gte("updated_at", since),
  ]);
  return {
    owner,
    business: BUSINESS_FIELDS.map((f) => ({ ...f, value: o[f.field]?.toString().trim() || null })),
    credentials: creds
      .map((c) => ({ name: c.name, kind: c.kind, number: c.number, issuer: c.issuer, expires: c.expiryDate, days: c.expiryDate ? between(today, c.expiryDate) : null }))
      .sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999)),
    connections: [
      { name: "ServiceM8", v: sm8 },
      { name: "Xero", v: xero },
    ].map(({ name, v }) => ({ name, connected: v?.status === "connected", account: v?.tenantName ?? null, since: v?.connectedAt ?? null, error: v?.lastError ?? null })),
    holidays,
    failed: count ?? 0,
  };
}
