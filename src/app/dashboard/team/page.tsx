import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth0 } from "@/lib/auth0";
import { Icon } from "@/components/shell/icon";
import { TeamDirectory } from "@/components/team/directory";
import { InviteButton } from "@/components/team/invite-modal";
import { can, getCapabilities, getDbRole } from "@/lib/permissions-server";
import { invitableRoles } from "@/lib/permissions";
import { listPendingInvites, listStaff } from "@/lib/staff/query";

// Capability-gated (`team`, default admin+): the directory exposes every staff
// member's card. The nav entry is hidden for staff too, but this is the check
// that actually enforces it.
//
// The directory never shows pay — listStaff selects identity columns only, so
// a wage cannot leak here even by accident.
//
// Inviting lives here and nowhere else. WHICH roles this viewer may create is a
// second question (invitableRoles: owner → admin or staff, a delegated inviter
// → staff only), decided here and re-checked by the action. An empty list is
// also the "can they invite at all" answer, so there's one gate, not two.

export default async function TeamPage() {
  if (!(await can("team"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [staff, pending, actorRole, caps] = await Promise.all([
    listStaff(orgId),
    listPendingInvites(orgId),
    getDbRole(),
    getCapabilities(),
  ]);
  const invitableAt = invitableRoles(actorRole, caps);
  const canInvite = invitableAt.length > 0;

  // Prefer the configured base URL; otherwise derive it from the incoming
  // request so invite links are always correct in production (never localhost).
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const appUrl =
    process.env.APP_BASE_URL ?? (host ? `${proto}://${host}` : "http://localhost:3000");

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                Team
              </h1>
            </div>
            {canInvite ? <InviteButton roles={invitableAt} /> : null}
          </div>

          {staff.length === 0 ? (
            <div className="emptybox">
              <span className="ei">
                <Icon name="users" size={24} />
              </span>
              <b>No staff yet</b>
              <em>Invite your team to start building staff profiles.</em>
            </div>
          ) : (
            <TeamDirectory
              staff={staff}
              pending={pending}
              canInvite={canInvite}
              appUrl={appUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
}
