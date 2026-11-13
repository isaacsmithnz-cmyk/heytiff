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
  /** the invite out to their card; `link` only for someone who may invite, as the web's Pending tab gives it */
  invite: { id: string; email: string; role: string; state: "live" | "expired"; link: string | null } | null;
};
/** Invites to an address, not yet to a card: Add a person's, waiting to be taken up. */
export type TeamInvite = { id: string; name: string | null; email: string; role: string; state: "live" | "expired"; link: string | null };
export type Team = { on: TeamPerson[]; notYet: TeamPerson[]; invited: TeamInvite[]; roles: { role: Role; label: string; blurb: string }[] };

/** The web's address, for an invite's link: the configured one, else the request's own (never localhost in production). */
export function appUrlOf(request: Request): string {
  return process.env.APP_BASE_URL ?? new URL(request.url).origin;
}

export async function readTeam(ctx: MobileCtx, appUrl: string): Promise<Team> {
  const [staff, { data: invites }, allowed] = await Promise.all([
    listStaff(ctx.orgId, 30),
    supabaseAdmin.from("invitations").select("id, email, role, expires_at, staff_profile_id, token, name").eq("org_id", ctx.orgId).is("accepted_at", null),
    actAsPhoneUser(ctx, async () => invitableRoles(await getDbRole(), await getCapabilities())),
  ]);
  type Row = { id: string; email: string; role: string; expires_at: string; staff_profile_id: string | null; token: string | null; name: string | null };
  const rows = (invites ?? []) as Row[];
  const byCard = new Map<string, Row>();
  for (const i of rows) if (i.staff_profile_id) byCard.set(i.staff_profile_id, i);
  const now = Date.now();
  /* the link is the invite itself: only for an invite at a role this person may send, so someone who may
     invite staff never holds the link to an owner's admin invite (found in review) */
  const linkOf = (i: Row) => ((allowed as string[]).includes(i.role) && i.token ? `${appUrl}/invite/accept?token=${i.token}` : null);
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
        invite: i ? { id: i.id, email: i.email, role: i.role, state: Date.parse(i.expires_at) > now ? "live" : "expired", link: linkOf(i) } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    on: people.filter((p) => p.role),
    notYet: people.filter((p) => !p.role),
    invited: rows
      .filter((i) => !i.staff_profile_id)
      .map((i) => ({ id: i.id, name: i.name, email: i.email, role: i.role, state: Date.parse(i.expires_at) > now ? ("live" as const) : ("expired" as const), link: linkOf(i) })),
    roles: allowed.map((role) => ({ role, label: ROLE_COPY[role].label, blurb: ROLE_COPY[role].blurb })),
  };
}
