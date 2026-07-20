import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { TeamDirectory } from "@/components/team/directory";
import { can } from "@/lib/permissions-server";
import { demoPendingInvites, demoStaff } from "@/mock/demo";

// NOTE: reads demo records from mock/demo.ts for now. Delete that mock and the
// directory falls back to the "No staff yet" empty state below.

// Capability-gated (`team`, default admin+): the directory exposes every staff
// member's card. The nav entry is hidden for staff too (nav.ts minRole), but
// this is the check that actually enforces it.

export default async function TeamPage() {
  if (!(await can("team"))) redirect("/dashboard");

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
            <Link
              href="/dashboard/admin/invite"
              className="pbtn primary"
              style={{ height: 44, flex: "0 0 auto" }}
            >
              <Icon name="plus" size={16} />
              Invite staff
            </Link>
          </div>

          {demoStaff.length === 0 ? (
            <div className="emptybox">
              <span className="ei">
                <Icon name="users" size={24} />
              </span>
              <b>No staff yet</b>
              <em>Invite your team to start building staff profiles.</em>
            </div>
          ) : (
            <TeamDirectory staff={demoStaff} pending={demoPendingInvites} />
          )}
        </div>
      </div>
    </div>
  );
}
