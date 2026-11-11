import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { listStaff } from "@/lib/staff/query";
import { getCapabilities, getDbRole } from "@/lib/permissions-server";
import { invitableRoles } from "@/lib/permissions";
import { ROLE_COPY, type Role } from "@/lib/roles-shared";
import { actAsPhoneUser, type MobileCtx } from "./auth";

/* THE TEAM ON THE PHONE (Isaac, 10 November 2026: "allow view of team for
   admin and ability to invite from app. Get the app almost full featured to
   limit web use"; https://claude.ai/artifact/26EjQygddnyfT9YYLP7EWo, built
   on 12 November: "Don't wait for my answers. Just build"). The web's own
   read (lib/staff/query listStaff) and its own invites (actions/invite), as
   the phone user, so the same people may do the same things: who's on
   HeyTiff with their role, who isn't yet, and an invite to a card, with
   its state. */

export type TeamPerson = {
  id: string;
  name: string;
  initials: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  /** their role on HeyTiff, once they're on it */
  role: string | null;
  invite: { id: string; email: string; role: string; state: "live" | "expired" } | null;
};
export type Team = { on: TeamPerson[]; notYet: TeamPerson[]; roles: { role: Role; label: string; blurb: string }[] };

export async function readTeam(ctx: MobileCtx): Promise<Team> {
  const [staff, { data: invites }, allowed] = await Promise.all([
    listStaff(ctx.orgId, 30),
    supabaseAdmin.from("invitations").select("id, email, role, expires_at, staff_profile_id").eq("org_id", ctx.orgId).is("accepted_at", null),
    actAsPhoneUser(ctx, async () => invitableRoles(await getDbRole(), await getCapabilities())),
  ]);
  const byCard = new Map<string, { id: string; email: string; role: string; expires_at: string }>();
  for (const i of (invites ?? []) as { id: string; email: string; role: string; expires_at: string; staff_profile_id: string | null }[])
    if (i.staff_profile_id) byCard.set(i.staff_profile_id, i);
  const now = Date.now();
  const people = staff
    .filter((s) => s.status === "Active")
    .map((s): TeamPerson => {
      const i = byCard.get(s.id);
      return {
        id: s.id,
        name: s.name,
        initials: s.initials,
        title: s.role && s.role !== "—" ? s.role : null,
        phone: s.phone ?? null,
        email: s.email && s.email !== "—" ? s.email : null,
        role: s.userId && s.orgRole ? ROLE_COPY[s.orgRole].label : null,
        invite: i ? { id: i.id, email: i.email, role: i.role, state: Date.parse(i.expires_at) > now ? "live" : "expired" } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    on: people.filter((p) => p.role),
    notYet: people.filter((p) => !p.role),
    roles: allowed.map((role) => ({ role, label: ROLE_COPY[role].label, blurb: ROLE_COPY[role].blurb })),
  };
}
