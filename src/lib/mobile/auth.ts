import { supabaseAdmin } from "@/lib/supabase-server";
import { resolve, type Capability } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import { checkMobileToken, tenantKeys, type KeyLookup } from "./token";

/* WHO THE PHONE IS, AND FOR WHICH WORKSPACE (native app, phase 1).

   The phone's routes run on the service role with RLS bypassed, exactly as
   the server actions' libraries do, so EVERYTHING here decides what they may
   read. The website's front door (permissions-server's requireOrg) takes WHO
   from the session's `sub` and WHERE from the session's `orgId`; the phone
   has no session, so:

     WHO    is the verified token's `sub` (./token), the same Auth0 user id
            the website's session carries.
     WHERE  is one of that person's own memberships, and only theirs. The
            phone may name one (the X-HeyTiff-Org header, for someone in two
            workspaces); without it, the workspace the website would open
            them in: the oldest membership, id as the tiebreak (auth0.ts's
            beforeSessionSaved). A named workspace they are not a member of
            is refused, never quietly swapped for their own.
     WHAT   is resolve(role, overrides) from that membership row, read on
            every call, so a capability the owner just revoked is gone on the
            phone's next request too.

   Nobody becomes a member here. The website's first sign-in makes the
   workspace and the staff card; the phone signs in only someone who already
   has one (a person must be invited on the web first, for now).

   EVERY REFUSAL IS LOUD. A server action that fails returns empty and the
   page says nothing; a phone has to know to sign in again, so a bad token is
   a 401 and a workspace or capability it may not have is a 403, each with a
   sentence. */

export type MobileCtx = {
  userId: string;
  orgId: string;
  role: Role | null;
  caps: Set<Capability>;
  /** Every workspace this person belongs to, the active one first. */
  orgIds: string[];
};

export const ORG_HEADER = "x-heytiff-org";

const json = (status: number, error: string): Response =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export const UNSIGNED = (): Response => json(401, "Sign in again.");

type MembershipRow = { org_id: string; role: string | null; permissions: unknown };

/** The phone's front door: a context to read with, or the response to send. */
export async function requireMobile(
  request: Request,
  capability?: Capability,
  opts: { keyFor?: KeyLookup; now?: number } = {}
): Promise<MobileCtx | Response> {
  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) {
    console.error("[mobile] AUTH0_DOMAIN is not set; refusing every phone call");
    return UNSIGNED();
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!bearer) return UNSIGNED();

  const check = await checkMobileToken(bearer[1]!, { domain, keyFor: opts.keyFor ?? tenantKeys(domain), now: opts.now });
  if (!check.ok) return UNSIGNED();
  const userId = check.sub;

  const { data, error } = await supabaseAdmin
    .from("memberships")
    .select("org_id, role, permissions")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error(`[mobile] couldn't read memberships: ${error.message}`);
    return json(503, "HeyTiff couldn't be reached. Try again.");
  }
  const rows = (data ?? []) as MembershipRow[];
  if (rows.length === 0) return json(403, "This sign-in has no HeyTiff workspace. Ask to be invited on the web first.");

  const asked = request.headers.get(ORG_HEADER)?.trim();
  const active = asked ? rows.find((r) => r.org_id === asked) : rows[0];
  if (!active) return json(403, "You're not a member of that workspace.");

  const role = (active.role as Role | null) ?? null;
  const caps = resolve(role, active.permissions);
  if (capability && !caps.has(capability)) return json(403, "You don't have access to that.");

  return {
    userId,
    orgId: active.org_id,
    role,
    caps,
    orgIds: [active.org_id, ...rows.map((r) => r.org_id).filter((id) => id !== active.org_id)],
  };
}

/** A route's answer: JSON the phone never caches. */
export const ok = (body: unknown): Response => Response.json(body, { headers: { "cache-control": "no-store" } });
