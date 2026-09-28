import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  INVITE_PROBLEM_REASONS,
  InviteProblem,
  type InviteProblemReason,
} from "@/components/start/invite-problem";

/* Where /invite/accept sends a link it cannot accept. The route passes a
   REASON and the token it was holding; the words, the company's name and the
   invited address are all read here, from the invitation row, never from the
   URL. An unknown or missing reason reads as a link that does not work. */

export default async function InviteErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; token?: string }>;
}) {
  const { reason: asked, token } = await searchParams;
  const reason: InviteProblemReason = INVITE_PROBLEM_REASONS.includes(asked as InviteProblemReason)
    ? (asked as InviteProblemReason)
    : "not_found";

  const session = await auth0.getSession();

  let company: string | null = null;
  let invitedEmail: string | null = null;
  if (token) {
    const { data: invite } = await supabaseAdmin
      .from("invitations")
      .select("email, org_id")
      .eq("token", token)
      .maybeSingle();
    if (invite) {
      invitedEmail = (invite.email as string | null) ?? null;
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("trading_name, legal_name")
        .eq("id", invite.org_id)
        .maybeSingle();
      /* trading_name first, as every screen shows it. `name` is left out on
         purpose: it is the legacy signup seed and holds an address often
         enough that "isaac@… invited you" is what it would print. */
      company = (org?.trading_name as string | null) || (org?.legal_name as string | null) || null;
    }
  }

  return (
    <InviteProblem
      reason={reason}
      company={company}
      invitedEmail={invitedEmail}
      signedInEmail={session?.user?.email ?? null}
    />
  );
}
