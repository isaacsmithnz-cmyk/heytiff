import { type NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) return NextResponse.redirect(new URL("/dashboard", request.url));

  const session = await auth0.getSession();
  if (!session) {
    const returnTo = encodeURIComponent(`/invite/accept?token=${token}`);
    return NextResponse.redirect(new URL(`/auth/login?returnTo=${returnTo}`, request.url));
  }

  const errRedirect = (msg: string) =>
    NextResponse.redirect(new URL(`/invite/error?msg=${encodeURIComponent(msg)}`, request.url));

  const { data: invite, error } = await supabaseAdmin
    .from("invitations")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !invite) return errRedirect("Invite not found or already used.");
  if (invite.accepted_at) return errRedirect("This invite has already been accepted.");
  if (new Date(invite.expires_at) < new Date()) return errRedirect("This invite has expired.");
  if (invite.email !== session.user.email) {
    return errRedirect(
      `This invite was sent to ${invite.email}. You're signed in as ${session.user.email}.`
    );
  }

  await supabaseAdmin
    .from("memberships")
    .upsert(
      { user_id: session.user.sub, org_id: invite.org_id, role: invite.role },
      { onConflict: "user_id,org_id" }
    );

  await supabaseAdmin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  await auth0.updateSession({
    ...session,
    orgId: invite.org_id,
    orgRole: invite.role,
  });

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
