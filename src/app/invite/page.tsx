import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getOrgRole, hasMinRole } from "@/lib/roles";
import { createInvite } from "@/app/actions/invite";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

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

  return (
    <div className="max-w-xl mx-auto p-8 flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Invite someone</h1>

      <form action={createInvite} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="Email address"
          className="border border-zinc-200 dark:border-zinc-700 rounded px-3 py-2 text-sm bg-transparent"
        />
        <select
          name="role"
          className="border border-zinc-200 dark:border-zinc-700 rounded px-3 py-2 text-sm bg-transparent"
        >
          <option value="admin">Admin</option>
          <option value="staff">Staff</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-black rounded dark:bg-zinc-50 dark:text-black"
        >
          Create invite
        </button>
      </form>

      {invites && invites.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-500">Pending invites</h2>
          {invites.map((inv) => (
            <div
              key={inv.id}
              className="text-sm border border-zinc-100 dark:border-zinc-800 rounded p-3 flex flex-col gap-1"
            >
              <div className="flex justify-between">
                <span>{inv.email}</span>
                <span className="text-zinc-400 capitalize">{inv.role}</span>
              </div>
              {!inv.accepted_at && (
                <div className="mt-1">
                  <p className="text-xs text-zinc-400 mb-1">Invite link (share manually):</p>
                  <code className="text-xs break-all text-zinc-600 dark:text-zinc-300">
                    {appUrl}/invite/accept?token={inv.token}
                  </code>
                </div>
              )}
              {inv.accepted_at && (
                <span className="text-xs text-green-600">Accepted</span>
              )}
            </div>
          ))}
        </div>
      )}

      <a href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-700">
        ← Back to dashboard
      </a>
    </div>
  );
}
