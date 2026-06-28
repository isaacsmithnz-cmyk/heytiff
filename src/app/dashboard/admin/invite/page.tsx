import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getOrgRole, hasMinRole } from "@/lib/roles";
import { createInvite } from "@/app/actions/invite";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Icon } from "@/components/shell/icon";
import { CopyLink } from "@/components/shell/copy-link";

export default async function InvitePage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const role = await getOrgRole();
  if (!hasMinRole(role, "admin")) redirect("/dashboard");

  const orgId = session.orgId as string;

  // Prefer the configured base URL; otherwise derive it from the incoming request
  // so invite links are always correct in production (never localhost).
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const appUrl =
    process.env.APP_BASE_URL ??
    (host ? `${proto}://${host}` : "http://localhost:3000");

  const { data: invites } = await supabaseAdmin
    .from("invitations")
    .select("id, email, role, token, accepted_at, expires_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 24,
    border: "1px solid #f0f0f2",
    boxShadow: "0 8px 30px rgba(0,0,0,.03)",
    padding: 32,
  };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "13px 16px",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 500,
    color: "#1f2937",
    outline: "none",
  };
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: ".15em",
    textTransform: "uppercase",
    color: "#9ca3af",
    marginBottom: 8,
    display: "block",
  };

  return (
    <div className="page in">
      <div className="wrap" style={{ maxWidth: 720 }}>
        <div className="stg">
          {/* header */}
          <div style={{ marginBottom: 32 }}>
            <a
              href="/dashboard/admin"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#9ca3af",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginBottom: 16,
              }}
            >
              ← Admin
            </a>
            <h1
              style={{
                fontSize: 44,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                margin: 0,
                color: "#050505",
              }}
            >
              Invite your team
            </h1>
            <p
              style={{
                fontSize: 15,
                color: "#6b7280",
                fontWeight: 500,
                marginTop: 8,
              }}
            >
              Send an invite link and assign a role. Share the link manually —
              email sending isn&apos;t wired up yet.
            </p>
          </div>

          {/* create form */}
          <form action={createInvite} style={card}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <label style={label} htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="name@company.com"
                  style={input}
                />
              </div>
              <div style={{ flex: "0 0 160px" }}>
                <label style={label} htmlFor="role">
                  Role
                </label>
                <select id="role" name="role" style={input} defaultValue="staff">
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              style={{
                marginTop: 20,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 24px",
                borderRadius: 12,
                background: "#050505",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              Create invite <Icon name="arrowR" size={16} />
            </button>
          </form>

          {/* pending / accepted invites */}
          {invites && invites.length > 0 && (
            <div style={{ marginTop: 40 }}>
              <div style={{ ...label, marginBottom: 16 }}>Invites</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {invites.map((inv) => {
                  const accent = inv.role === "admin" ? "#2E68FF" : "#00A389";
                  return (
                    <div key={inv.id} style={{ ...card, padding: 24 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "#050505",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {inv.email}
                        </span>
                        <span
                          style={{
                            flex: "0 0 auto",
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: ".08em",
                            textTransform: "uppercase",
                            fontFamily: "var(--font-jetbrains), monospace",
                            padding: "4px 10px",
                            borderRadius: 8,
                            color: accent,
                            background: `${accent}15`,
                            border: `1px solid ${accent}30`,
                          }}
                        >
                          {inv.role}
                        </span>
                      </div>

                      {inv.accepted_at ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            marginTop: 12,
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#00A389",
                          }}
                        >
                          <Icon name="shield" size={14} /> Accepted
                        </span>
                      ) : (
                        <CopyLink
                          url={`${appUrl}/invite/accept?token=${inv.token}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
