import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { Icon } from "@/components/shell/icon";
import { TeamDirectory } from "@/components/team/directory";
import { can } from "@/lib/permissions-server";
import { listPendingInvites, listStaff } from "@/lib/staff/query";

// Capability-gated (`team`, default admin+): the directory exposes every staff
// member's card. The nav entry is hidden for staff too, but this is the check
// that actually enforces it.
//
// The directory never shows pay — listStaff selects identity columns only, so
// a wage cannot leak here even by accident.

export default async function TeamPage() {
  if (!(await can("team"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [staff, pending, canInvite] = await Promise.all([
    listStaff(orgId),
    listPendingInvites(orgId),
    can("invites"),
  ]);

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
            {canInvite ? (
              <Link
                href="/dashboard/admin/invite"
                className="pbtn primary"
                style={{ height: 44, flex: "0 0 auto" }}
              >
                <Icon name="plus" size={16} />
                Invite staff
              </Link>
            ) : null}
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
            <TeamDirectory staff={staff} pending={pending} />
          )}
        </div>
      </div>
    </div>
  );
}
