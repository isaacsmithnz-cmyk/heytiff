/* The workspace's people by the words that name them (./people-named), read
   for the box on the phone (api/mobile/people) and on the web (api/people).
   Names only, nothing to reach them by. A read that fails answers empty: the
   names stay plain. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { personWords, type Person } from "./people-named";

export async function workspacePeople(orgId: string): Promise<Person[]> {
  const [staff, aliases] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select("id, full_name, first_name, preferred_name, status").eq("org_id", orgId).eq("status", "Active"),
    supabaseAdmin.from("staff_aliases").select("staff_profile_id, alias").eq("org_id", orgId),
  ]);
  type Row = { id: string; full_name: string | null; first_name: string | null; preferred_name: string | null };
  const nick = new Map<string, string[]>();
  for (const a of (aliases.data ?? []) as { staff_profile_id: string; alias: string }[]) {
    nick.set(a.staff_profile_id, [...(nick.get(a.staff_profile_id) ?? []), a.alias]);
  }
  return ((staff.data ?? []) as Row[])
    .filter((r) => r.full_name?.trim())
    .map((r) => ({
      id: r.id,
      name: r.full_name!.trim().replace(/\s+/g, " "),
      words: personWords({ fullName: r.full_name!, firstName: r.first_name, preferredName: r.preferred_name, aliases: nick.get(r.id) }),
    }));
}
