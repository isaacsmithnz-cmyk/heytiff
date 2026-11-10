import { ok, requireMobile } from "@/lib/mobile/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

/* THE NAMES THE PHONE KNOWS (Isaac, 10 November 2026: "saying a person's name
   turned their name a different color to register that it was connected to
   someone else in the organization"). Each active person on the workspace, by
   the words that name them: their full name, first name, preferred name and
   the nicknames Tiff has learned (staff_aliases). Names only, nothing to reach
   them by. The phone colours these as they're typed or said; the note flow
   still decides who a task is for. Any member may read it. */

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const [staff, aliases] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select("id, full_name, first_name, preferred_name, status").eq("org_id", ctx.orgId).eq("status", "Active"),
    supabaseAdmin.from("staff_aliases").select("staff_profile_id, alias").eq("org_id", ctx.orgId),
  ]);
  type Row = { id: string; full_name: string | null; first_name: string | null; preferred_name: string | null };
  const nick = new Map<string, string[]>();
  for (const a of (aliases.data ?? []) as { staff_profile_id: string; alias: string }[]) {
    nick.set(a.staff_profile_id, [...(nick.get(a.staff_profile_id) ?? []), a.alias]);
  }
  const people = ((staff.data ?? []) as Row[])
    .filter((r) => r.full_name?.trim())
    .map((r) => {
      const name = r.full_name!.trim().replace(/\s+/g, " ");
      const first = (r.first_name?.trim() || name.split(" ")[0]) ?? "";
      const words = [...new Set([name, first, r.preferred_name?.trim() ?? "", ...(nick.get(r.id) ?? [])].filter((w) => w.length >= 2))];
      return { id: r.id, name, words };
    });
  return ok({ people });
}
