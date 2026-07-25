import { type NextRequest, NextResponse } from "next/server";
import { auth0, ensureStaffCard } from "@/lib/auth0";
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
  // Case-insensitive: the row is stored lowercased, but Auth0 relays the
  // identity provider's casing. Only the comparison normalises — the error
  // message below shows each address as its own side spelt it.
  if (invite.email.toLowerCase() !== session.user.email?.toLowerCase()) {
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

  /* The staff card has to exist before they land on /dashboard. `updateSession`
     below writes the cookie directly and does NOT run `beforeSessionSaved`, so
     nothing else creates it until their NEXT sign-in — and without it
     `staffProfileIdFor` returns null, which silently refuses commenting,
     reacting, RSVPing, poll votes and every document upload ("No staff record
     for this account"), and leaves them out of the team list so they can't even
     be assigned a task. That's the whole first session for every invited
     employee, which is the one path every real staff member takes. */
  await ensureStaffCard(invite.org_id, session.user.sub, session);

  await auth0.updateSession({
    ...session,
    orgId: invite.org_id,
    orgRole: invite.role,
  });

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
