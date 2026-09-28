import { AFTER, DoorFrame, LEAD, PRIMARY, TITLE } from "./door";

/* What an invitation link says when it cannot be accepted.

   IT WAS A SENTENCE IN RED ON A BLANK PAGE, built from a `?msg=` the accept
   route spelt out, with the invited and signed-in addresses riding in the URL.
   So the page could say anything a link told it to, on the screen a sceptical
   stranger meets first. Now the route sends a REASON, and every word below is
   ours.

   EACH REASON ENDS IN WHAT TO DO NEXT, because each one has a different next
   step and none of them is visible from the invitee's side:

   - wrong account — the one they can fix themselves, so it is the only one
     with the door in the card: sign out, then open the email again. Signing
     out cannot carry them back to the invitation (the tenant's logout return
     list is not ours to assume), so the sentence carries it instead;
   - expired — the renewal is one press on the INVITER's side, and saying so
     is the difference between waiting and giving up (the same words /start
     uses, so the two screens agree);
   - used — nearly always themselves, a second click, so the door is the
     workspace;
   - not found — a withdrawn invitation or a link cut short in a mail client. */

export type InviteProblemReason = "wrong_account" | "expired" | "used" | "not_found";

export const INVITE_PROBLEM_REASONS: readonly InviteProblemReason[] = [
  "wrong_account",
  "expired",
  "used",
  "not_found",
];

export function InviteProblem({
  reason,
  company,
  invitedEmail,
  signedInEmail,
}: {
  reason: InviteProblemReason;
  /** The inviting company's name, or null when the token found nothing or it has none. */
  company: string | null;
  /** The address the invitation is bound to — shown only to say it is not this one. */
  invitedEmail: string | null;
  /** Null when nobody is signed in. */
  signedInEmail: string | null;
}) {
  const signedIn = signedInEmail !== null;

  const footer =
    signedIn && reason !== "wrong_account" ? (
      <p className="text-sm text-zinc-500">
        {`Signed in as ${signedInEmail}. `}
        <a className="font-semibold text-zinc-700 underline underline-offset-2" href="/auth/logout">
          Sign out
        </a>
      </p>
    ) : undefined;

  return (
    <DoorFrame footer={footer}>
      {reason === "wrong_account" && (
        <>
          <h1 className={TITLE}>This invitation is for another address</h1>
          <p className={LEAD}>
            It was sent to <b className="text-zinc-700">{invitedEmail ?? "a different address"}</b>
            {signedInEmail ? (
              <>
                {" "}
                and you’re signed in as <b className="text-zinc-700">{signedInEmail}</b>
              </>
            ) : null}
            . Sign out, then open the invitation from the email again.
          </p>
          <a className={PRIMARY} href="/auth/logout">
            Sign out
          </a>
        </>
      )}

      {reason === "expired" && (
        <>
          <h1 className={TITLE}>That invitation has expired</h1>
          <p className={LEAD}>
            {company
              ? `${company} invited you, but invitations run out after seven days. Ask them to renew it from their Team page and you’ll get a fresh link.`
              : "Invitations run out after seven days. Ask whoever invited you to renew it from their Team page and you’ll get a fresh link."}
          </p>
        </>
      )}

      {reason === "used" && (
        <>
          <h1 className={TITLE}>This invitation has already been used</h1>
          <p className={LEAD}>
            {signedIn
              ? "It can only be accepted once. If it was you, you’re already in."
              : `It can only be accepted once. If it was you, sign in to open ${company ?? "your workspace"}.`}
          </p>
          {signedIn ? (
            <a className={PRIMARY} href="/dashboard">
              Open HeyTiff
            </a>
          ) : (
            <a className={PRIMARY} href="/auth/login">
              Sign in
            </a>
          )}
        </>
      )}

      {reason === "not_found" && (
        <>
          <h1 className={TITLE}>This invitation link doesn’t work</h1>
          <p className={LEAD}>
            It may have been withdrawn, or the link was cut short. Ask whoever invited you to send it
            again.
          </p>
          {signedIn ? (
            <p className={`${AFTER} text-sm text-zinc-500`}>
              <a className="font-semibold text-zinc-700 underline underline-offset-2" href="/dashboard">
                Open HeyTiff
              </a>
            </p>
          ) : null}
        </>
      )}
    </DoorFrame>
  );
}
