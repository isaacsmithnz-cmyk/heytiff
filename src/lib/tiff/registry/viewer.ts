/* WHO IS ASKING — server only.

   Built once per request from the membership row, with no session read, so
   the ask route and the eval runner (which has no session) share it. The
   route used to ask `can()` twice, and `getMembership`'s React `cache()` does
   not memoise inside a route handler, so each call read the membership
   again; one read here replaces both.

   FAIL CLOSED, as permissions-server does: a missing or unreadable
   membership is no capabilities and no role. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import type { Viewer } from "./types";

export async function viewerForUser(orgId: string, userId: string): Promise<Viewer> {
  const [membership, staffId, tz] = await Promise.all([
    supabaseAdmin
      .from("memberships")
      .select("role, permissions")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle(),
    staffIdFor(orgId, userId),
    getSm8Timezone(orgId),
  ]);
  const row = membership.error ? null : (membership.data as { role: Role | null; permissions: unknown } | null);
  const role = row?.role ?? null;
  return {
    orgId,
    userId,
    staffId,
    role,
    caps: row ? resolve(role, row.permissions) : new Set(),
    tz,
    today: todayInZone(tz),
  };
}
