import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { createMyOrg } from "@/app/actions/org-create";
import { StartScreen, type StartState } from "@/components/start/start-screen";

/* The door for a signed-in person who belongs to nowhere.

   THIS STATE USED TO BE IMPOSSIBLE, and that was the bug. Signing in founded
   a company for anyone without a membership, so "I was invited but I signed
   up first" produced a silent phantom org with that person as its owner. The
   auto-creation is gone (lib/auth0.ts); this screen is what replaced it, and
   the proxy sends every org-less session here.

   IT ANSWERS THE QUESTION BEFORE ASKING IT. The overwhelmingly common reason
   to arrive with no workspace is an invitation, so the page looks for one on
   this address first and leads with it — named, with the company and the role
   spelt out. Founding a company is the other door, and it is quieter when an
   invite is waiting, because pressing it there is the mistake this whole
   change exists to prevent. It is never removed: being invited somewhere is
   not a reason you may not also run your own business.

   THE INVITE IS ACCEPTED BY ITS OWN ROUTE, not by a second copy of the accept
   logic living here. The token is handed to the browser only after the row's
   address has been matched against the signed-in identity — it is this
   person's own invite, the same string the emailed link carries. */

export default async function StartPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (session.orgId) redirect("/dashboard");

  const userId = session.user.sub;
  const email = session.user.email?.toLowerCase() ?? null;

  /* A membership with no orgId in the cookie: they joined somewhere in another
     browser, or the session predates it. Nothing here can fix a cookie — only
     a fresh sign-in re-runs beforeSessionSaved — so the screen says so and
     offers the door, rather than redirecting into a loop with the proxy if the
     two reads ever disagreed. */
  const { data: memberships } = await supabaseAdmin
    .from("memberships")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1);

  let state: StartState = { kind: memberships?.[0] ? "member" : "none" };

  if (!memberships?.[0] && email) {
    /* Newest first: renewing does not create a row, so more than one open
       invite to this address means two different companies want them, and the
       most recent is the one they are most likely holding a link for. */
    const { data: invites } = await supabaseAdmin
      .from("invitations")
      .select("token, role, org_id, expires_at")
      .eq("email", email)
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    const invite = invites?.[0];
    if (invite) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("trading_name, legal_name, name")
        .eq("id", invite.org_id)
        .maybeSingle();

      /* trading_name is what every screen shows; `name` is the legacy signup
         seed and is somebody's email address often enough that it is the last
         resort, not the first. */
      const company =
        (org?.trading_name as string | null) ||
        (org?.legal_name as string | null) ||
        (org?.name as string | null) ||
        null;

      const live = new Date(invite.expires_at as string) > new Date();
      state = live
        ? {
            kind: "invite",
            company,
            role: invite.role === "admin" ? "Admin" : "Staff",
            token: invite.token as string,
          }
        : { kind: "expired", company };
    }
  }

  return <StartScreen state={state} email={session.user.email ?? null} onCreate={createMyOrg} />;
}
