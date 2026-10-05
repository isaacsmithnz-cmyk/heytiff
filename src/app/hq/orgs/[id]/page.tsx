import { notFound } from "next/navigation";
import { requireHqPage } from "@/lib/hq/guard";
import { supabaseAdmin } from "@/lib/supabase-server";
import { joinMembersToProfiles } from "@/lib/hq/overview";
import { formatDate, formatTenure } from "@/lib/hq/format";
import { DeleteWorkspace } from "@/components/hq/delete-workspace";

/* Org drill-down — the member list for one organisation. A nested route (not
   client-side expansion) so it's server-rendered, shareable and keeps the
   overview payload small. */

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireHqPage();
  const { id } = await params;

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!org) notFound();

  const { data: members } = await supabaseAdmin
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", id);

  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("user_id, email, name, last_login_at")
        .in("user_id", userIds)
    : { data: [] };

  const rows = joinMembersToProfiles(members ?? [], profiles ?? []);

  /* Delete is offered only on a workspace you don't belong to that holds
     nothing but setup — a test sign-up. The function re-decides at delete
     time; this read only decides whether to draw the button. */
  const own = rows.some((r) => r.userId === me.userId);
  const { data: records } = own
    ? { data: null }
    : await supabaseAdmin.rpc("hq_workspace_records", { p_org: id });
  const deletable = Array.isArray(records) && records.length === 0;

  return (
    <main className="hq-main">
      <a className="hq-back" href="/hq">
        Back to overview
      </a>
      <h1 className="hq-h1">{org.name}</h1>
      <p className="hq-lede">
        Signed up {formatDate(org.created_at)}, {rows.length} member
        {rows.length === 1 ? "" : "s"}
      </p>

      <h2 className="hq-section-h">Members</h2>
      {rows.length === 0 ? (
        <div className="hq-empty">No members.</div>
      ) : (
        <div className="hq-card">
          <table className="hq-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Tenure</th>
                <th>Last login</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>
                    {r.hasProfile ? (
                      <>
                        <div className="hq-strong">{r.name ?? r.email}</div>
                        {r.name && r.email ? (
                          <div className="hq-muted">{r.email}</div>
                        ) : null}
                      </>
                    ) : (
                      <span className="hq-noprofile">
                        hasn&apos;t signed in since profiles went live
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`hq-badge ${r.role}`}>
                      {ROLE_LABEL[r.role] ?? r.role}
                    </span>
                  </td>
                  <td className="hq-muted">{formatDate(r.joinedAt)}</td>
                  <td className="hq-muted">{formatTenure(r.joinedAt)}</td>
                  <td className="hq-muted">{formatDate(r.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deletable ? (
        <>
          <h2 className="hq-section-h hq-del-h">Delete workspace</h2>
          <DeleteWorkspace orgId={org.id} name={org.name} />
        </>
      ) : null}
    </main>
  );
}
