import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { resolve, type Capability } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

/** Everyone in a workspace who holds a capability (an owner holds them
    all; a role's defaults, less or plus their own grants), as staff cards,
    less one: who a push about it goes to. */
export async function staffHolding(orgId: string, capability: Capability, except: string | null): Promise<string[]> {
  const { data } = await supabaseAdmin.from("memberships").select("user_id, role, permissions").eq("org_id", orgId);
  const users = ((data ?? []) as { user_id: string | null; role: string | null; permissions: unknown }[])
    .filter((m) => m.user_id && resolve((m.role as Role | null) ?? null, m.permissions).has(capability))
    .map((m) => m.user_id as string);
  if (!users.length) return [];
  const { data: staff } = await supabaseAdmin.from("staff_profiles").select("id").eq("org_id", orgId).in("user_id", users);
  return ((staff ?? []) as { id: string }[]).map((s) => String(s.id)).filter((id) => id !== except);
}
