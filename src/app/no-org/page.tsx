import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Chevron, Wordmark } from "@/components/logo";

/* THE DOOR FOR SOMEONE WHO IS SIGNED IN AND PART OF NO COMPANY.

   Before this page that state had no surface at all. `loadDashboard` and
   `getCapabilities` both answer "nothing" without an org rather than throwing,
   so the person got a fully-rendered Home with an empty rail and zero of
   everything — a screen that reads as "the app lost my data", from which the
   only recovery was to find the invite link they had already walked past.

   It exists because uninvited signup no longer mints an org (lib/auth0.ts), and
   it earns its place by CLOSING THE LOOP rather than just apologising: the
   single likeliest way to arrive here is to have been invited and to have typed
   the address in instead of tapping the link — invite emails aren't sent yet
   (actions/invite.ts), so the link lives in a text message that is easy to
   miss. So the page looks the invite up and hands it back.

   Outside the dashboard shell on purpose: the shell is org-scoped furniture,
   and drawing it around someone who has no org is what made the empty state
   confusing in the first place. */

export const dynamic = "force-dynamic";

type Invite = {
  token: string;
  expires_at: string;
  org: string | null;
};

/* An unaccepted invite for this address, expired or not. The expired case is
   worth SHOWING rather than hiding: it names the company that wanted them and
   turns "this app is broken" into one sentence their admin can act on with the
   Renew button that already exists on the Team page.

   A LIVE INVITE OUTRANKS A NEWER DEAD ONE, which is why this reads twice
   instead of sorting once. Newest-first is the obvious ordering and it is
   wrong here: `created_at` and `expires_at` come apart the moment an invite is
   renewed, because renewInvite pushes the expiry and leaves the creation
   stamp alone (actions/invite.ts). Nothing stops the same address holding a
   pending invite in two companies either — createInvite's duplicate check, and
   the unique index behind it, are both scoped to one org. So a renewed day-1
   invite can be live while a lapsed day-3 invite sorts above it, and the
   single-read version would answer the door with "your invitation has
   expired" while the one that still works sat one row down, unreachable from
   this screen.

   The liveness filter also has to go to the DATABASE rather than being sorted
   for, because `expires_at DESC` picks a winner among the expired too. Reading
   live-then-any is the whole rule in two lines, and it degrades the right way
   on a null expiry: `gt` drops those rows from the first read, the second one
   still finds them, and the render below already reads a null as expired. */
async function pendingInvite(email: string): Promise<Invite | null> {
  const unaccepted = () =>
    supabaseAdmin
      .from("invitations")
      .select("token, expires_at, org_id")
      .eq("email", email.toLowerCase())
      .is("accepted_at", null);

  type InviteRow = { token: string; expires_at: string; org_id: string };

  const { data: liveRows } = await unaccepted()
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  let row = liveRows?.[0] as InviteRow | undefined;

  if (!row) {
    const { data: anyRows } = await unaccepted()
      .order("created_at", { ascending: false })
      .limit(1);
    row = anyRows?.[0] as InviteRow | undefined;
  }

  if (!row) return null;

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("name, trading_name")
    .eq("id", row.org_id)
    .maybeSingle();

  /* TRADING NAME FIRST, and it is not a cosmetic preference. `name` is whatever
     org creation was handed at signup, which was the founder's EMAIL ADDRESS —
     every organisation in prod is called something like
     `isaacsmithnz1@gmail.com`, while the one that trades carries "Diamond Air
     Solutions" in trading_name. Greeting an invitee with their boss's personal
     address, on the one screen whose whole job is to look legitimate enough to
     click a button on, is how an invite becomes a phishing report.

     An address is still better than nothing if that is genuinely all the org
     has, so this falls back rather than blanking — but the fallback reads as a
     prompt to go and set the name in Admin → Organisation. */
  const named = (org?.trading_name as string | undefined) || (org?.name as string | undefined);

  return {
    token: row.token,
    expires_at: row.expires_at,
    org: named ?? null,
  };
}

export default async function NoOrgPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  /* The proxy sends people here, so it has to send them back out again once
     they belong somewhere — otherwise accepting an invite in another tab
     leaves this page insisting they are homeless. */
  if ((session as { orgId?: string }).orgId) redirect("/dashboard");

  const email = session.user.email ?? null;

  /* The invite is only offered to a login whose address the identity provider
     has actually confirmed. The accept route re-checks the match itself, so
     this is belt-and-braces rather than the only guard — but the token is a
     bearer credential and an unverified address is not proof of anything. */
  const verified = (session.user as { email_verified?: boolean }).email_verified === true;
  const invite = email && verified ? await pendingInvite(email) : null;
  const live = invite ? new Date(invite.expires_at) > new Date() : false;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      {/* Branded because this is the FIRST HeyTiff screen a new employee ever
          sees — they arrive holding a link from their boss, and a bare
          sentence on white is indistinguishable from a phishing page or a
          crash. Decorative: the wordmark beside it already says the name. */}
      <div className="mb-1 flex items-center gap-2">
        <Chevron size={26} gradient decorative />
        <Wordmark className="text-xl" />
      </div>

      {/* THE HEADLINE FOLLOWS THE SITUATION, and the common case is not a
          problem. Somebody who was invited and typed the address in instead of
          tapping the link is one click from being finished — greeting them
          with "you're not part of a company yet" states the failure and buries
          the fix, which is exactly backwards on the screen that decides whether
          onboarding completes. They get an invitation; only a genuine stranger
          gets the flat statement of where they stand. */}
      {invite && live ? (
        <h1 className="text-2xl font-semibold">
          {invite.org ? <>Join {invite.org}</> : <>You&apos;ve been invited</>}
        </h1>
      ) : (
        <h1 className="text-2xl font-semibold">You&apos;re not part of a company yet</h1>
      )}

      {email ? (
        <p className="text-sm text-zinc-500">
          Signed in as <strong className="text-zinc-700">{email}</strong>
        </p>
      ) : null}

      {invite && live ? (
        <>
          <p className="max-w-sm text-sm text-zinc-600">
            Accept the invitation to finish setting up your account.
          </p>
          <a
            href={`/invite/accept?token=${encodeURIComponent(invite.token)}`}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Accept invitation
          </a>
        </>
      ) : invite ? (
        <p className="max-w-sm text-sm text-zinc-600">
          Your invitation{invite.org ? <> to {invite.org}</> : null} has expired. Ask whoever
          invited you to renew it — they can do that from the Team page.
        </p>
      ) : (
        <p className="max-w-sm text-sm text-zinc-600">
          Ask your administrator to invite {email ? "this address" : "you"}. You&apos;ll get a
          link that adds you to the team.
        </p>
      )}

      {/* zinc-500, not the zinc-400 this started as: 400 measures 2.62:1 on
          white, which is under AA for 14px text. 500 is 4.83:1. The wordmark's
          teal above it reads 3.18:1 and stays — a brand name is exempt from
          the contrast requirement, and this is the one place the mark is the
          logotype rather than decoration. */}
      <a href="/auth/logout" className="text-sm text-zinc-500 hover:text-zinc-700">
        Sign out
      </a>
    </main>
  );
}
