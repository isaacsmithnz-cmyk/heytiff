import Link from "next/link";
import { Icon } from "@/components/shell/icon";

// NOTE: one demo member for now (matches the design export). Swap to real staff
// records + the "No staff yet" empty state once the staff table exists.
const demoStaff = [
  {
    id: "jordan-mills",
    initials: "JM",
    name: "Jordan Mills",
    role: "Lead Installer",
    vehicle: "VRF-04",
    compliance: { label: "ARC expires 14d", warn: true },
  },
];

export default function TeamPage() {
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

          <div className="dir">
            <div className="dirhead">
              <span>Name</span>
              <span>Role</span>
              <span>Vehicle</span>
              <span>Compliance</span>
            </div>
            {demoStaff.map((s) => (
              <Link key={s.id} href={`/dashboard/team/${s.id}`} className="dirrow">
                <span className="dname">
                  <span className="dav">{s.initials}</span>
                  <span>
                    <b>{s.name}</b>
                  </span>
                </span>
                <span className="drole">{s.role}</span>
                <span className="dveh">{s.vehicle}</span>
                <span className={`dchip${s.compliance.warn ? " warn" : ""}`}>
                  <Icon name="alert" size={12} />
                  {s.compliance.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
